// Оккупация домов: противник занимает жильё вместо мгновенного разрушения.
// Этажность и стройка сохраняются; город теряет население и налоги, пока дом занят.
import { markChanged, type OccupiedHome, type World } from './world';

const LIMIT: Record<OccupiedHome['source'], number> = { band: 2, landing: 3 };

function homeRoot(w: World, index: number): number {
  const tile = w.tiles[index];
  if (!tile || tile.object !== 'zone' || tile.zone !== 'R' || tile.level < 1) return -1;
  const root = tile.root >= 0 ? tile.root : index;
  const main = w.tiles[root];
  return main?.object === 'zone' && main.zone === 'R' && main.level > 0 ? root : -1;
}

export function isHomeOccupied(w: World, index: number): boolean {
  const root = homeRoot(w, index);
  return root >= 0 && w.occupiedHomes.some((x) => x.root === root);
}

/** Один дом захватывается один раз, даже если враги ходят по нескольким клеткам его участка. */
export function occupyHome(w: World, index: number, source: OccupiedHome['source']): boolean {
  if (w.civic) return false;
  const root = homeRoot(w, index);
  if (root < 0 || w.occupiedHomes.some((x) => x.root === root) ||
      w.occupiedHomes.filter((x) => x.source === source).length >= LIMIT[source]) return false;
  w.occupiedHomes.push({ root, source, sinceDay: w.day });
  const x = root % w.size, y = Math.floor(root / w.size);
  markChanged(w, root);
  w.events.push({ type: 'homeOccupied', x, y, source });
  return true;
}

/** Победа/уход вражеского отряда освобождает все занятые им квартиры без ручного ремонта. */
export function releaseOccupiedHomes(w: World, source: OccupiedHome['source']) {
  if (!w.occupiedHomes.length) return;
  const remaining: OccupiedHome[] = [];
  for (const entry of w.occupiedHomes) {
    if (entry.source !== source) { remaining.push(entry); continue; }
    markChanged(w, entry.root);
    w.events.push({ type: 'homeFreed', x: entry.root % w.size, y: Math.floor(entry.root / w.size) });
  }
  w.occupiedHomes = remaining;
}

/** Удаляет лишь невозможные и устаревшие записи; старые сохранения без поля безопасны. */
export function normalizeOccupiedHomes(w: World): OccupiedHome[] {
  const records: unknown[] = Array.isArray(w.occupiedHomes) ? w.occupiedHomes : [];
  const seen = new Set<number>();
  const next: OccupiedHome[] = [];
  for (const raw of records) {
    if (!raw || typeof raw !== 'object') continue;
    const o = raw as Partial<OccupiedHome>;
    if (!Number.isInteger(o.root) || o.root! < 0 || o.root! >= w.tiles.length ||
        (o.source !== 'band' && o.source !== 'landing') ||
        (o.source === 'band' && !w.band) ||
        (o.source === 'landing' && !w.crash?.landed) ||
        seen.has(o.root!) || homeRoot(w, o.root!) !== o.root) continue;
    seen.add(o.root!);
    next.push({ root: o.root!, source: o.source,
      sinceDay: Number.isInteger(o.sinceDay) && o.sinceDay! > 0 ? o.sinceDay! : w.day });
  }
  return next;
}

/** После уничтожения дома оккупация больше не должна блокировать другие участки. */
export function reconcileOccupiedHomes(w: World) {
  const next = normalizeOccupiedHomes(w);
  if (next.length === w.occupiedHomes.length) return;
  for (const o of w.occupiedHomes) if (!next.some((n) => n.root === o.root)) markChanged(w, o.root);
  w.occupiedHomes = next;
}
