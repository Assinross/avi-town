// Главные улицы (spec 010, вопрос 1 - Avi 2026-10-30: "автоматически"): без отдельного инструмента.
// Улица - непрерывный прямой ряд клеток дороги по одной оси, через перекрёстки. Главная - длинная
// (от MIN_LEN клеток) и с примыканиями (от MIN_BRANCHES) или очень длинная (от LONG), её вес не меньше
// SHARE от лучшей улицы, и параллельные главные не ближе SPACING клеток: в ровной сетке главная -
// каждая вторая-третья улица, как проспекты через несколько кварталов.
// На главных - двойная жёлтая осевая и стоп-линии; светофор - где пересекаются две главные (вопрос 2),
// на остальных перекрёстках главная улица едет первой, между равными - помеха справа.

import { tileAt, type World } from '@avi/sim';

/** Бит главной улицы вдоль x. */
export const MAIN_X = 1;
/** Бит главной улицы вдоль z (y симуляции). */
export const MAIN_Z = 2;

const MIN_LEN = 8;
const MIN_BRANCHES = 2;
const LONG = 16;
const SHARE = 0.5;
const SPACING = 12;

let cacheWorld: World | null = null;
let cacheRevision = -1;
let cache = new Uint8Array(0);

const isRoad = (w: World, x: number, y: number) => tileAt(w, x, y)?.object === 'road';

/** Маска главных улиц по клеткам (MAIN_X | MAIN_Z); считается заново только при изменении мира. */
export function mainStreets(w: World): Uint8Array {
  if (cacheWorld === w && cacheRevision === w.revision) return cache;
  const s = w.size;
  const out = new Uint8Array(s * s);
  // Ряды по обеим осям: клетки ряда, длина, число примыканий поперёк
  const runs: { cells: number[]; bit: number; score: number; line: number; k0: number; k1: number }[] = [];
  for (const bit of [MAIN_X, MAIN_Z]) {
    const [ax, ay] = bit === MAIN_X ? [1, 0] : [0, 1];
    for (let line = 0; line < s; line++) {
      let cells: number[] = [], branches = 0;
      const close = (k: number) => {
        const len = cells.length;
        if (len >= MIN_LEN && (branches >= MIN_BRANCHES || len >= LONG)) runs.push({ cells, bit, score: len + 3 * branches, line, k0: k - len, k1: k - 1 });
        cells = [];
        branches = 0;
      };
      for (let k = 0; k < s; k++) {
        const x = ax ? k : line, y = ax ? line : k;
        if (!isRoad(w, x, y)) {
          close(k);
          continue;
        }
        cells.push(y * s + x);
        if (isRoad(w, x + ay, y + ax) || isRoad(w, x - ay, y - ax)) branches++;
      }
      close(s);
    }
  }
  const best = runs.reduce((m, r) => Math.max(m, r.score), 0);
  // Сильные первыми; при равном весе - по порядку рядов, чтобы выбор не прыгал
  runs.sort((a, b) => b.score - a.score || a.bit - b.bit || a.line - b.line);
  const chosen: typeof runs = [];
  for (const r of runs) {
    if (r.score < best * SHARE) break;
    const near = chosen.some((c) => c.bit === r.bit && Math.abs(c.line - r.line) < SPACING && c.k0 <= r.k1 && r.k0 <= c.k1);
    if (near) continue;
    chosen.push(r);
    for (const c of r.cells) out[c] |= r.bit;
  }
  cacheWorld = w;
  cacheRevision = w.revision;
  cache = out;
  return out;
}

/** Перекрёсток со светофором: через клетку идут две главные улицы. */
export const signalJunction = (main: Uint8Array, cell: number) => main[cell] === (MAIN_X | MAIN_Z);
