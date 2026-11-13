// Служба восстановления после ударов НЛО: очередь и расчистка по игровым дням.
// Физический выезд коммунальной машины реализуется отдельным этапом.
import { BUILDING_BY_ID, RECOVERY } from '@avi/data';
import { markChanged, type RecoverySite, type World, type ZoneType } from './world';

const workDays = (cells: number) => Math.max(1, Math.min(RECOVERY.maxDays, cells * RECOVERY.daysPerCell));

/** Разрушение многоклеточного здания создаёт одну задачу; повторы не дублируются. */
export function registerRecovery(w: World, cells: number[]) {
  const occupied = new Set(w.recoverySites.flatMap((s) => s.cells));
  const unique = [...new Set(cells)].filter((i) => Number.isInteger(i) && i >= 0 &&
    i < w.tiles.length && !occupied.has(i));
  if (!unique.length) return;
  const zones = unique.flatMap((i) => {
    const tile = w.tiles[i];
    return tile.object === 'zone' && tile.zone ? [{ index: i, zone: tile.zone }] : [];
  });
  w.recoverySites.push({
    id: w.recoverySites.reduce((max, s) => Math.max(max, s.id), 0) + 1,
    cells: unique, zones, status: 'waiting', officeRoot: null,
    remainingDays: workDays(unique.length), createdDay: w.day,
  });
  w.revision++;
}

/** Ручной снос удаляет завалы из очереди и возвращает исходное зонирование. */
export function manualClearRecovery(w: World, indices: Iterable<number>): Map<number, ZoneType> {
  const cleared = new Set(indices);
  const restored = new Map<number, ZoneType>();
  let changed = false;
  const pending: RecoverySite[] = [];
  for (const site of w.recoverySites) {
    const remaining = site.cells.filter((i) => !cleared.has(i));
    if (remaining.length === site.cells.length) {
      pending.push(site);
      continue;
    }
    changed = true;
    for (const z of site.zones) if (cleared.has(z.index)) restored.set(z.index, z.zone);
    if (remaining.length) pending.push({
      ...site, cells: remaining, zones: site.zones.filter((z) => !cleared.has(z.index)),
      remainingDays: Math.min(site.remainingDays, workDays(remaining.length)),
    });
  }
  if (changed) {
    w.recoverySites = pending;
    w.revision++;
  }
  return restored;
}

/** Дороги у здания службы и на расстоянии пары клеток от аварийного объекта. */
function roadsNear(w: World, cells: number[], radius: number): number[] {
  const result = new Set<number>();
  for (const cell of cells) {
    const x = cell % w.size, y = Math.floor(cell / w.size);
    for (let dy = -radius; dy <= radius; dy++) for (let dx = -radius; dx <= radius; dx++) {
      if (Math.abs(dx) + Math.abs(dy) > radius) continue;
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= w.size || ny >= w.size) continue;
      const i = ny * w.size + nx;
      if (w.tiles[i].object === 'road') result.add(i);
    }
  }
  return [...result];
}

/** Проверка достижимости площадки по существующей сети дорог. */
function roadDistance(w: World, officeRoot: number, site: RecoverySite): number {
  const size = BUILDING_BY_ID[RECOVERY.officeId].size;
  const officeCells: number[] = [];
  const x0 = officeRoot % w.size, y0 = Math.floor(officeRoot / w.size);
  for (let dy = 0; dy < size; dy++) for (let dx = 0; dx < size; dx++) {
    officeCells.push((y0 + dy) * w.size + x0 + dx);
  }
  const starts = roadsNear(w, officeCells, 1);
  const goals = new Set(roadsNear(w, site.cells, RECOVERY.roadAccessRadius));
  if (!starts.length || !goals.size) return Infinity;
  const dist = new Int32Array(w.tiles.length).fill(-1);
  const queue = [...starts];
  for (const start of starts) dist[start] = 0;
  for (let p = 0; p < queue.length; p++) {
    const i = queue[p];
    if (goals.has(i)) return dist[i];
    const x = i % w.size, y = Math.floor(i / w.size);
    for (const j of [x > 0 ? i - 1 : -1, x < w.size - 1 ? i + 1 : -1,
      y > 0 ? i - w.size : -1, y < w.size - 1 ? i + w.size : -1]) {
      if (j < 0 || dist[j] >= 0 || w.tiles[j].object !== 'road') continue;
      dist[j] = dist[i] + 1;
      queue.push(j);
    }
  }
  return Infinity;
}

/** Одно работающее управление ведёт один объект; потеря тока/дороги ставит его на паузу. */
export function recoveryDay(w: World) {
  if (!w.recoverySites.length || w.over) return;
  const offices: number[] = [];
  w.tiles.forEach((t, i) => {
    if (t.object === 'building' && t.root === i && t.def === RECOVERY.officeId &&
        t.build === 0 && t.powered) offices.push(i);
  });
  const available = new Set(offices);
  for (const site of w.recoverySites) {
    if (site.officeRoot !== null && available.has(site.officeRoot) &&
        roadDistance(w, site.officeRoot, site) < Infinity) {
      available.delete(site.officeRoot);
    } else if (site.officeRoot !== null) {
      site.officeRoot = null;
      site.status = 'waiting';
      w.revision++;
    }
  }
  const completed = new Set<number>();
  for (const site of w.recoverySites) {
    if (site.officeRoot === null) {
      let choice: number | null = null, distance = Infinity;
      for (const office of available) {
        const d = roadDistance(w, office, site);
        if (d < distance) { distance = d; choice = office; }
      }
      if (choice === null) continue;
      site.officeRoot = choice;
      site.status = 'clearing';
      available.delete(choice);
      const cell = site.cells[0];
      w.events.push({ type: 'recoveryStarted', x: cell % w.size, y: Math.floor(cell / w.size) });
      w.revision++;
      continue; // День назначения ещё не является рабочим.
    }
    if (--site.remainingDays > 0) {
      w.revision++;
      continue;
    }
    let restoredZones = 0;
    const zones = new Map(site.zones.map((z) => [z.index, z.zone]));
    for (const i of site.cells) {
      const tile = w.tiles[i];
      if (tile.object !== 'rubble') continue; // Место падения НЛО не трогать.
      const zone = zones.get(i);
      tile.object = zone ? 'zone' : 'none';
      tile.zone = zone ?? null;
      tile.level = 0;
      tile.root = -1;
      tile.build = 0;
      tile.lot = 0;
      tile.powered = false;
      tile.watered = false;
      if (zone) restoredZones++;
      markChanged(w, i);
    }
    completed.add(site.id);
    const cell = site.cells[0];
    w.events.push({ type: 'recoveryCompleted', x: cell % w.size, y: Math.floor(cell / w.size), restoredZones });
    w.revision++;
  }
  if (completed.size) w.recoverySites = w.recoverySites.filter((s) => !completed.has(s.id));
}

/** Нормализация при загрузке: задачи не должны ссылаться на отсутствующие завалы. */
export function normalizeRecovery(w: World): RecoverySite[] {
  if (!Array.isArray(w.recoverySites)) return [];
  const used = new Set<number>(), ids = new Set<number>();
  const sites: RecoverySite[] = [];
  for (const raw of w.recoverySites) {
    if (!raw || !Number.isSafeInteger(raw.id) || raw.id <= 0 || ids.has(raw.id) ||
        !Array.isArray(raw.cells)) continue;
    const cells = [...new Set(raw.cells.filter((i) => Number.isInteger(i) && i >= 0 &&
      i < w.tiles.length && w.tiles[i].object === 'rubble' && !used.has(i)))];
    if (!cells.length) continue;
    const zones = (Array.isArray(raw.zones) ? raw.zones : []).filter((z) =>
      z && cells.includes(z.index) && ['R', 'C', 'I', 'A'].includes(z.zone))
      .map((z) => ({ index: z.index as number, zone: z.zone as ZoneType }));
    const officeRoot = Number.isInteger(raw.officeRoot) && raw.officeRoot >= 0 &&
      raw.officeRoot < w.tiles.length &&
      w.tiles[raw.officeRoot].object === 'building' &&
      w.tiles[raw.officeRoot].root === raw.officeRoot &&
      w.tiles[raw.officeRoot].def === RECOVERY.officeId ? raw.officeRoot : null;
    sites.push({
      id: raw.id, cells, zones,
      status: officeRoot !== null && raw.status === 'clearing' ? 'clearing' : 'waiting',
      officeRoot, createdDay: Number.isInteger(raw.createdDay) ? raw.createdDay : w.day,
      remainingDays: Number.isInteger(raw.remainingDays) && raw.remainingDays > 0
        ? Math.min(raw.remainingDays, workDays(cells.length)) : workDays(cells.length),
    });
    ids.add(raw.id);
    cells.forEach((i) => used.add(i));
  }
  return sites;
}
