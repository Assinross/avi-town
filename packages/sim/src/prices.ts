// Цены строек и сноса. Отдельный модуль, чтобы проверка места кольца могла
// считать стоимость сноса, не создавая циклический импорт с commands.ts.

import { BUILDING_BY_ID } from '@avi/data';
import type { Tile } from './world';

export const PRICES = {
  road: 10,
  /** Проспект: цена за клетку пары, пара - 24 ¢. */
  avenue: 12,
  /** Кольцо целиком: 3x3 клетки, площадь с островком. */
  roundabout: 300,
  zone: 5,
  bulldoze: { road: 5, ruin: 40, rubble: 15, tree: 5, building: 50, zoneLevel: 20, crash: 0 },
  /** Доля денег, которая возвращается при сносе недостроенного здания, в процентах. */
  siteRefund: 50,
  assault: 800,
} as const;

/** Сколько стоит снести клетку: у недостроенного здания часть цены возвращается. */
export function bulldozeCost(t: Tile): number {
  // Недостроенное здание: стройку сворачивают и возвращают часть денег
  if (t.object === 'building' && t.build > 0) return -Math.floor(((BUILDING_BY_ID[t.def!]?.cost.money ?? 0) * PRICES.siteRefund) / 100);
  switch (t.object) {
    case 'road': return PRICES.bulldoze.road;
    case 'ruin': return PRICES.bulldoze.ruin;
    case 'rubble': return PRICES.bulldoze.rubble;
    case 'tree': return PRICES.bulldoze.tree;
    case 'building': return PRICES.bulldoze.building;
    case 'zone': return t.level * PRICES.bulldoze.zoneLevel;
    default: return 0;
  }
}
