// Участки жилья и торговли: дом занимает группу клеток зоны вдоль улицы (как у CityRT/TheoTown,
// но своя логика). Главная клетка участка стоит у дороги и хранит его форму в поле lot;
// остальные клетки ссылаются на неё через root и повторяют её level и build.

import { markChanged, tileAt, type Tile, type World, type ZoneType } from './world';

/** Направления к дороге: +x, -x, +y, -y. */
export const DIRS: readonly [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1]];

/** Форма участка по уровню: [ширина вдоль улицы, глубина от улицы]. */
export const LOT_SHAPES: Partial<Record<ZoneType, readonly [number, number][]>> = {
  R: [[0, 0], [1, 1], [1, 2], [2, 2]],
  C: [[0, 0], [1, 1], [2, 1], [2, 2]],
};

/** Жильё и торговля растут участками; промзоны и фермы - по клеткам. */
export const usesLots = (t: Tile) => !!t.zone && !!LOT_SHAPES[t.zone];

export interface LotShape {
  /** Индекс в DIRS - в какую сторону от главной клетки дорога. */
  dir: number;
  /** Куда участок растёт вдоль улицы от главной клетки: 1 или -1. */
  side: number;
  w: number;
  d: number;
}

export function encodeLot(s: LotShape): number {
  return 1 + s.dir + ((s.side > 0 ? 1 : 0) << 2) + ((s.w - 1) << 3) + ((s.d - 1) << 5);
}

export function decodeLot(code: number): LotShape | null {
  if (!code) return null;
  const c = code - 1;
  return { dir: c & 3, side: (c >> 2) & 1 ? 1 : -1, w: ((c >> 3) & 3) + 1, d: ((c >> 5) & 3) + 1 };
}

/** Клетки участка формы s с главной клеткой root (null - вылезает за карту). */
export function shapeCells(w: World, root: number, s: LotShape): number[] | null {
  const [dx, dy] = DIRS[s.dir];
  const px = -dy * s.side, py = dx * s.side;
  const x0 = root % w.size, y0 = Math.floor(root / w.size);
  const out: number[] = [];
  for (let f = 0; f < s.d; f++) {
    for (let u = 0; u < s.w; u++) {
      const x = x0 + u * px - f * dx, y = y0 + u * py - f * dy;
      if (!tileAt(w, x, y)) return null;
      out.push(y * w.size + x);
    }
  }
  return out;
}

export function lotCells(w: World, root: number): number[] {
  const s = decodeLot(w.tiles[root].lot);
  return s ? shapeCells(w, root, s) ?? [root] : [root];
}

/** Центр участка в клетках (для отрисовки) и направление фасада. */
export function lotCenter(w: World, root: number): { x: number; y: number; s: LotShape } | null {
  const s = decodeLot(w.tiles[root].lot);
  if (!s) return null;
  const [dx, dy] = DIRS[s.dir];
  const px = -dy * s.side, py = dx * s.side;
  const x0 = root % w.size, y0 = Math.floor(root / w.size);
  return { x: x0 + 0.5 + ((s.w - 1) * px - (s.d - 1) * dx) / 2, y: y0 + 0.5 + ((s.w - 1) * py - (s.d - 1) * dy) / 2, s };
}

/** Свободная клетка той же зоны, которую участок может занять: пустая или достроенный дом соседа ниже уровнем - его вытесняет больший дом. */
function freeFor(w: World, idx: number, zone: ZoneType, root: number, level: number): boolean {
  const t = w.tiles[idx];
  if (t.object !== 'zone' || t.zone !== zone) return false;
  if (t.root === root || (t.root < 0 && t.level === 0)) return true;
  const other = t.root >= 0 ? w.tiles[t.root] : null;
  return !!other && other.level < level && other.build === 0;
}

/** Подобрать форму участка на уровень level: сперва прежние направление и сторона, потом любые у дороги. */
export function fitLot(w: World, root: number, level: number): { s: LotShape; cells: number[] } | null {
  const t = w.tiles[root];
  const shape = LOT_SHAPES[t.zone!]?.[level];
  if (!shape) return null;
  const x = root % w.size, y = Math.floor(root / w.size);
  const tries: [number, number][] = [];
  const cur = decodeLot(t.lot);
  if (cur) tries.push([cur.dir, cur.side]);
  DIRS.forEach(([dx, dy], dir) => {
    if (tileAt(w, x + dx, y + dy)?.object === 'road') tries.push([dir, 1], [dir, -1]);
  });
  for (const [dir, side] of tries) {
    const s = { dir, side, w: shape[0], d: shape[1] };
    const cells = shapeCells(w, root, s);
    if (cells && cells.every((c) => freeFor(w, c, t.zone!, root, level))) return { s, cells };
  }
  return null;
}

/** Поставить участок: новые клетки получают уровень и стройку главной, лишние освобождаются. */
export function setLot(w: World, root: number, level: number, build: number, s: LotShape, cells: number[]) {
  // Вытесненные соседние дома сносятся целиком
  for (const c of cells) {
    const other = w.tiles[c].root;
    if (other >= 0 && other !== root) releaseLot(w, other);
  }
  const old = w.tiles[root].lot ? lotCells(w, root) : [root];
  for (const c of old) {
    if (cells.includes(c)) continue;
    vacate(w.tiles[c]);
    markChanged(w, c);
  }
  for (const c of cells) {
    const t = w.tiles[c];
    t.root = root;
    t.level = level;
    t.build = build;
    t.lot = c === root ? encodeLot(s) : 0;
    markChanged(w, c);
  }
}

/** Снести дом участка: все клетки снова пустые участки зоны. */
export function releaseLot(w: World, root: number) {
  for (const c of lotCells(w, root)) {
    vacate(w.tiles[c]);
    markChanged(w, c);
  }
}

function vacate(t: Tile) {
  t.root = -1;
  t.level = 0;
  t.build = 0;
  t.lot = 0;
}

/** Дом теряет уровень (налёт, упадок): участок ужимается до формы меньшего уровня. */
export function shrinkLot(w: World, root: number) {
  const t = w.tiles[root];
  const level = t.level - 1;
  if (level <= 0) return releaseLot(w, root);
  const cur = decodeLot(t.lot)!;
  const shape = LOT_SHAPES[t.zone!]![level];
  const s = { ...cur, w: shape[0], d: shape[1] };
  setLot(w, root, level, 0, s, shapeCells(w, root, s)!);
}
