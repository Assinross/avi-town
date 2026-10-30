// Общие детали генератора зданий: коробка в осях дома, стороны стен, деталь на стене,
// окно с рамой, переплётом, подоконником и перемычкой, якорь ночного огня. Рецепты домов
// (brick.ts, house.ts, shop.ts) собираются из них.

import type { GeoBuilder } from '../builder';
import type { LightKind } from '../nightPlan';

/** Оси участка: u - вдоль улицы, f - к улице; rot - поворот фасада, как у GeoBuilder.box. */
export interface Frame {
  at(u: number, f: number): readonly [number, number];
  rot: number;
}

/** Метр в клетках (клетка ~10 м). */
export const M = 0.1;

/** Сторона дома: нормаль (nu, nf), длина стены, расстояние до неё от центра, поворот огня. */
export interface Side {
  nu: number;
  nf: number;
  len: number;
  half: number;
  turn: number;
}

/** Стороны дома w x d: фасад (+f), зад, правая (+u) и левая (-u). */
export const sidesOf = (w: number, d: number): Side[] => [
  { nu: 0, nf: 1, len: w, half: d / 2, turn: 0 },
  { nu: 0, nf: -1, len: w, half: d / 2, turn: Math.PI },
  { nu: 1, nf: 0, len: d, half: w / 2, turn: Math.PI / 2 },
  { nu: -1, nf: 0, len: d, half: w / 2, turn: -Math.PI / 2 },
];

/** Деталь на стене: t - вдоль стены, out - наружу от стены, st/sn - размеры вдоль стены и наружу. */
export type Part = (t: number, y: number, out: number, st: number, sy: number, sn: number, color: number, top?: number) => void;

/** Набор для дома с центром основания (u0, f0) на высоте y0 в осях участка o. */
export function houseKit(g: GeoBuilder, o: Frame, u0: number, f0: number, y0: number) {
  // Коробка в осях дома: (u, f) - центр основания, su - вдоль фасада, sf - вглубь
  const box = (u: number, y: number, f: number, su: number, sy: number, sf: number, color: number, top = color) => {
    const [x, z] = o.at(u0 + u, f0 + f);
    g.box(x, y0 + y, z, su, sy, sf, color, o.rot, top);
  };
  const at = (s: Side, t: number, out: number) =>
    [s.nu * (s.half + out) + (s.nu ? 0 : t), s.nf * (s.half + out) + (s.nf ? 0 : t)] as const;
  const part = (s: Side): Part => (t, y, out, st, sy, sn, color, top = color) => {
    const [u, f] = at(s, t, out);
    box(u, y, f, s.nu ? sn : st, sy, s.nu ? st : sn, color, top);
  };
  /** Якорь ночного огня на стене - чуть перед стеклом; y - низ проёма. */
  const light = (s: Side, kind: LightKind, t: number, y: number, w: number, h: number, seed: number, color: number, level: number) => {
    const [u, f] = at(s, t, 0.02);
    const [x, z] = o.at(u0 + u, f0 + f);
    g.light(kind, x, y0 + y + h / 2, z, o.rot + s.turn, seed, color, w, h, level);
  };
  return { box, part, light };
}

/** Цвета окна: рама и переплёт, стекло, подоконник и перемычка. */
export interface WindowPaint {
  frame: number;
  glass: number;
  stone: number;
}

/** Окно w x h с низом проёма на высоте y: рама, стекло, переплёт, подоконник, перемычка. */
export function windowAt(p: Part, t: number, y: number, w: number, h: number, c: WindowPaint) {
  p(t, y - 0.01, 0, w + 0.02, h + 0.02, 0.012, c.frame);
  p(t, y, 0.006, w - 0.02, h - 0.02, 0.008, c.glass);
  p(t, y, 0.006, 0.012, h - 0.02, 0.012, c.frame);
  p(t, y - 0.022, 0, w + 0.05, 0.014, 0.03, c.stone);
  p(t, y + h, 0, w + 0.04, 0.025, 0.014, c.stone);
}

export const hash = (v: number, salt: number) => {
  const s = Math.sin(v * 12.9898 + salt * 78.233) * 43758.5453;
  return s - Math.floor(s);
};
