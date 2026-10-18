// Процедурная геометрия карты по состоянию мира. Тайл = 1 единица, центр тайла (x+0.5, z+0.5).

import { tileAt, type Tile, type World } from '@avi/sim';
import { GeoBuilder } from './builder';
import { PALETTE, pick } from './palette';

const FLOOR = 0.32;
const WATER_TOP = -0.14;

export function buildCityGeometry(w: World) {
  const g = new GeoBuilder();
  for (let y = 0; y < w.size; y++) {
    for (let x = 0; x < w.size; x++) {
      const t = tileAt(w, x, y)!;
      const cx = x + 0.5, cz = y + 0.5;
      const top = t.terrain === 'water' ? WATER_TOP : 0;
      g.box(cx, -0.6, cz, 1, 0.6 + top, 1, PALETTE.dirtSide, 0, pick(PALETTE.ground[t.terrain], t.variant));
      addTerrainDetail(g, t, cx, cz);
      addObject(g, w, t, x, y, cx, cz);
    }
  }
  return g.build();
}

function rnd(variant: number, salt: number): number {
  // Детерминированное псевдослучайное 0..1 из варианта тайла - только для внешнего вида
  const s = Math.sin(variant * 12.9898 + salt * 78.233) * 43758.5453;
  return s - Math.floor(s);
}

function addTerrainDetail(g: GeoBuilder, t: Tile, cx: number, cz: number) {
  if (t.object !== 'none') return;
  if (t.terrain === 'contaminated' && t.variant % 3 === 0) {
    g.box(cx + (rnd(t.variant, 1) - 0.5) * 0.5, 0, cz + (rnd(t.variant, 2) - 0.5) * 0.5, 0.35, 0.02, 0.25, PALETTE.toxic, rnd(t.variant, 3) * 3);
  }
  if (t.terrain === 'rock') {
    const n = 1 + (t.variant % 3);
    for (let i = 0; i < n; i++) {
      const s = 0.18 + rnd(t.variant, i + 10) * 0.25;
      g.box(cx + (rnd(t.variant, i + 20) - 0.5) * 0.6, 0, cz + (rnd(t.variant, i + 30) - 0.5) * 0.6, s, s * 0.8, s, pick(PALETTE.boulder, i + t.variant), rnd(t.variant, i) * 3);
    }
  }
}

function addObject(g: GeoBuilder, w: World, t: Tile, x: number, y: number, cx: number, cz: number) {
  const v = t.variant;
  switch (t.object) {
    case 'road': {
      g.box(cx, 0, cz, 1, 0.03, 1, PALETTE.asphalt);
      // Разметка - полосы от центра к соседним дорогам
      const dirs: [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1]];
      let links = 0;
      for (const [dx, dy] of dirs) {
        if (tileAt(w, x + dx, y + dy)?.object !== 'road') continue;
        links++;
        g.box(cx + dx * 0.28, 0.03, cz + dy * 0.28, dx ? 0.22 : 0.05, 0.005, dy ? 0.22 : 0.05, PALETTE.marking);
      }
      if (links === 0) g.box(cx, 0.03, cz, 0.1, 0.005, 0.1, PALETTE.marking);
      break;
    }
    case 'ruin': {
      const floors = 1 + (v % 4);
      const sx = 0.6 + rnd(v, 1) * 0.3, sz = 0.6 + rnd(v, 2) * 0.3;
      const color = pick(PALETTE.concrete, v);
      const h = floors * FLOOR;
      g.box(cx, 0, cz, sx, h, sz, color);
      // Обломанный верх - смещённый блок пониже
      if (floors > 1) g.box(cx + (rnd(v, 3) - 0.5) * 0.2, h, cz + (rnd(v, 4) - 0.5) * 0.2, sx * 0.5, FLOOR * rnd(v, 5), sz * 0.45, color);
      // Ряды пустых окон
      for (let f = 0; f < floors; f++) {
        const wy = f * FLOOR + FLOOR * 0.4;
        g.box(cx, wy, cz, sx + 0.02, FLOOR * 0.28, sz * 0.7, PALETTE.window);
        g.box(cx, wy, cz, sx * 0.7, FLOOR * 0.28, sz + 0.02, PALETTE.window);
      }
      break;
    }
    case 'house': {
      const walls = pick(PALETTE.planks, v);
      const roof = pick(PALETTE.roofRust, v >> 2);
      const sx = 0.62, sz = 0.5, wh = 0.34;
      g.box(cx, 0, cz, sx, wh, sz, walls);
      g.gable(cx, wh, cz, sx + 0.1, 0.24, sz + 0.12, roof, walls);
      g.box(cx - 0.12, 0, cz + sz / 2 + 0.005, 0.12, 0.22, 0.02, PALETTE.door);
      g.box(cx + 0.15, wh * 0.45, cz + sz / 2 + 0.005, 0.12, 0.1, 0.02, PALETTE.window);
      g.box(cx + 0.18, wh + 0.1, cz - 0.08, 0.07, 0.25, 0.07, pick(PALETTE.concrete, v));
      // Огородик или бочка рядом
      if (v % 2 === 0) g.box(cx + 0.33, 0, cz - 0.3, 0.1, 0.16, 0.1, pick(PALETTE.roofRust, v));
      break;
    }
    case 'tree': {
      const h = 0.25 + rnd(v, 1) * 0.2;
      const ox = (rnd(v, 2) - 0.5) * 0.4, oz = (rnd(v, 3) - 0.5) * 0.4;
      g.box(cx + ox, 0, cz + oz, 0.07, h, 0.07, PALETTE.trunk);
      if (v % 4 !== 0) {
        const leaves = pick(PALETTE.leaves, v);
        g.box(cx + ox, h, cz + oz, 0.36, 0.2, 0.36, leaves, rnd(v, 4));
        g.box(cx + ox, h + 0.2, cz + oz, 0.22, 0.14, 0.22, leaves, rnd(v, 5));
      } else {
        // Сухое дерево - голые ветки
        g.box(cx + ox + 0.06, h * 0.7, cz + oz, 0.16, 0.04, 0.04, PALETTE.trunk, rnd(v, 6));
        g.box(cx + ox, h * 0.85, cz + oz - 0.05, 0.04, 0.04, 0.14, PALETTE.trunk, rnd(v, 7));
      }
      break;
    }
    case 'rubble': {
      const n = 3 + (v % 3);
      for (let i = 0; i < n; i++) {
        const s = 0.08 + rnd(v, i) * 0.16;
        g.box(cx + (rnd(v, i + 10) - 0.5) * 0.7, 0, cz + (rnd(v, i + 20) - 0.5) * 0.7, s * 1.4, s * 0.6, s, pick(PALETTE.concrete, v + i), rnd(v, i + 30) * 3);
      }
      break;
    }
    case 'none':
      break;
  }
}
