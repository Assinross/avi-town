// Кольцо - отдельный объект 3x3 клетки: площадь с газонным островком и кольцевой
// проезжей частью. В мире хранится только центр и маска примыканий; клетки блока
// считаются дорогой (object = 'road', road = 2), поэтому ток и вода идут через них.

import { BUILDING_BY_ID } from '@avi/data';
import { DIRS, lotCells } from './lots';
import { bulldozeCost, PRICES } from './prices';
import { irradiated } from './explore';
import { tileAt, type World } from './world';

/** Сторона блока кольца в клетках. */
export const ROUNDABOUT_SIZE = 3;

export interface Roundabout {
  /** Центральная клетка блока 3x3. */
  cell: number;
  /** Маска примыканий: биты DIRS (+x, -x, +y, -y). */
  arms: number;
}

/** Причины отказа в постройке кольца - подмножество ReasonCode из commands.ts. */
export type RoundaboutReason = 'out_of_map' | 'no_money' | 'blocked' | 'nothing' | 'water' | 'fog' | 'radiation';

export type RoundaboutCheck =
  | {
    ok: true;
    /** Девять клеток блока. */
    cells: number[];
    /** Все клетки, которые нужно очистить, включая клетки домов и зданий за пределами блока. */
    clear: number[];
    /** Главные клетки участков, которые сносятся целиком. */
    lots: number[];
    /** Мешающие дома и здания (для показа игроку). */
    blocked: number[];
    /** Стоимость сноса, ¢. */
    demolition: number;
    /** Итоговая цена постройки, ¢. */
    cost: number;
    /** Маска примыканий после постройки. */
    arms: number;
  }
  | { ok: false; reason: RoundaboutReason; blocked: number[] };

/** Девять клеток блока с центром (cx, cy); null - блок вылезает за карту. */
export function roundaboutCells(w: World, cx: number, cy: number): number[] | null {
  if (cx < 1 || cy < 1 || cx > w.size - 2 || cy > w.size - 2) return null;
  const out: number[] = [];
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) out.push((cy + dy) * w.size + cx + dx);
  }
  return out;
}

/** Кольцо, которому принадлежит клетка блока, либо null. */
export function roundaboutAt(w: World, cell: number): Roundabout | null {
  for (const r of w.roundabouts) {
    const cells = roundaboutCells(w, r.cell % w.size, (r.cell / w.size) | 0);
    if (cells?.includes(cell)) return r;
  }
  return null;
}

/** Маска примыканий: дорога с любой из трёх клеток у каждой стороны блока. */
export function roundaboutArms(w: World, cx: number, cy: number): number {
  const cells = roundaboutCells(w, cx, cy);
  if (!cells) return 0;
  const inside = new Set(cells);
  let arms = 0;
  for (let d = 0; d < 4; d++) {
    const [nx, ny] = DIRS[d];
    const px = -ny, py = nx;
    for (let k = -1; k <= 1; k++) {
      const x = cx + nx * 2 + px * k;
      const y = cy + ny * 2 + py * k;
      const t = tileAt(w, x, y);
      if (t?.object === 'road' && !inside.has(y * w.size + x)) {
        arms |= 1 << d;
        break;
      }
    }
  }
  return arms;
}

/**
 * Можно ли поставить кольцо с центром (cx, cy). `upgrade` - превращение готового
 * перекрёстка: тогда мешающие дома и здания разрешено снести за плату.
 */
export function canPlaceRoundabout(w: World, cx: number, cy: number, upgrade = false): RoundaboutCheck {
  const cells = roundaboutCells(w, cx, cy);
  if (!cells) return { ok: false, reason: 'out_of_map', blocked: [] };

  const blocked: number[] = [];
  const clear = new Set<number>(cells);
  const lots = new Set<number>();
  const roots = new Set<number>();
  let demolition = 0;

  // Улучшение - только на перекрёстке: центр должен быть дорогой
  if (upgrade && w.tiles[cy * w.size + cx]?.object !== 'road') return { ok: false, reason: 'nothing', blocked: [] };

  for (const i of cells) {
    const t = w.tiles[i];
    const x = i % w.size, y = (i / w.size) | 0;
    if (!w.explored[i]) return { ok: false, reason: 'fog', blocked: [] };
    if (t.terrain === 'water') return { ok: false, reason: 'water', blocked: [] };
    if (irradiated(w, x, y)) return { ok: false, reason: 'radiation', blocked: [] };
    if (t.object === 'road') {
      // Уже кольцо - менять нечего
      if (t.road === 2) return { ok: false, reason: 'nothing', blocked: [] };
      continue;
    }
    if (t.object === 'crash') return { ok: false, reason: 'blocked', blocked: [i] };
    if (t.object === 'building') {
      const def = BUILDING_BY_ID[t.def!];
      // Бункер и прочие несносимые здания - отказ при любом варианте
      if (def?.fixed) return { ok: false, reason: 'blocked', blocked: [i] };
      blocked.push(i);
      if (upgrade) roots.add(t.root >= 0 ? t.root : i);
      continue;
    }
    if (t.object === 'zone' && t.level > 0) {
      blocked.push(i);
      if (!upgrade) continue;
      if (t.root >= 0) lots.add(t.root);
      else demolition += bulldozeCost(t);
      continue;
    }
    // Пустая клетка, дерево, обломки, разметка зоны без дома - расчищаются молча
  }

  if (blocked.length && !upgrade) return { ok: false, reason: 'blocked', blocked };

  // Здания и участки сносятся целиком, даже если часть клеток за пределами блока
  for (const root of roots) {
    w.tiles.forEach((t, i) => { if (t.root === root) clear.add(i); });
    demolition += bulldozeCost(w.tiles[root]);
  }
  for (const root of lots) {
    for (const c of lotCells(w, root)) clear.add(c);
    demolition += bulldozeCost(w.tiles[root]);
  }

  return {
    ok: true,
    cells,
    clear: [...clear],
    lots: [...lots],
    blocked,
    demolition,
    cost: PRICES.roundabout + demolition,
    arms: roundaboutArms(w, cx, cy),
  };
}
