// Рецепт: домик уровня 1 (участок R1) - один этаж и мансарда: дощатая обшивка, крутая двускатная
// крыша с мансардным окном, крыльцо с козырьком, у части вариантов веранда и ставни. Каждый
// четвёртый - барак из подручного: заплаты из досок и железа, ржавая крыша, заколоченное
// окно (город восстанавливают после катастрофы). Фасад - к улице (+f в осях участка).

import type { GeoBuilder } from '../builder';
import { PALETTE, pick } from '../palette';
import { hash, houseKit, sidesOf, windowAt, type Frame } from './parts';

const PLINTH = 0.03;
const WALL = 0.28;
const WIN_W = 0.09, WIN_H = 0.12, SILL_Y = 0.09;
const RISE = 0.26;
const EAVE = 0.035;

const COLOR = {
  siding: [0xc9b08a, 0xa8b8a0, 0xd8cdb8, 0x9fb0bf, 0xb98f6a] as const,
  roof: [0x5b5f66, 0x7a3b2e, 0x4f6b55] as const,
  shutter: [0x3f5f4a, 0x7a3b32, 0x3d5670] as const,
  trim: 0xece6da,
  plinth: 0x7a716a,
  glass: 0x3d4b57,
  door: 0x5a3a28,
  chimney: 0x8c4a3a,
  sheet: 0x8a8f94,
};
const LIGHT_WINDOW = 0xffd9a0;

/** Домик w x d (в клетках) с центром основания (u0, f0) на высоте y0; v - вариант. */
export function cottageHouse(g: GeoBuilder, o: Frame, v: number, u0: number, f0: number, y0: number, w: number, d: number) {
  const barrack = v % 4 === 3;
  const siding = barrack ? pick(PALETTE.planks, v) : COLOR.siding[v % COLOR.siding.length];
  const roof = barrack ? pick(PALETTE.roofRust, v >> 2) : COLOR.roof[(v >> 2) % COLOR.roof.length];
  const veranda = !barrack && v % 3 === 1;
  const shutters = !barrack && v % 2 === 0;
  const paint = { frame: barrack ? pick(PALETTE.planks, v + 1) : COLOR.trim, glass: COLOR.glass, stone: barrack ? pick(PALETTE.planks, v + 2) : COLOR.trim };
  const { box, part: on, light } = houseKit(g, o, u0, f0, y0);
  const sides = sidesOf(w, d);
  const top = PLINTH + WALL;

  box(0, 0, 0, w + 0.01, PLINTH, d + 0.01, COLOR.plinth);
  box(0, PLINTH, 0, w, WALL, d, siding);
  if (!barrack) for (const s of [-1, 1]) for (const e of [-1, 1]) box(s * (w / 2 - 0.008), PLINTH, e * (d / 2 - 0.008), 0.02, WALL, 0.02, COLOR.trim);

  // Окна: по два на фасаде (у двери) и сзади, по одному на боках
  const spots: [number, number][] = [[0, -w * 0.3], [0, w * 0.3], [1, -w * 0.25], [1, w * 0.25], [2, 0], [3, 0]];
  spots.forEach(([si, t], i) => {
    const s = sides[si], part = on(s);
    const y = PLINTH + SILL_Y;
    windowAt(part, t, y, WIN_W, WIN_H, paint);
    if (shutters && si === 0) for (const e of [-1, 1]) part(t + e * (WIN_W / 2 + 0.025), y, 0.004, 0.035, WIN_H, 0.01, COLOR.shutter[v % COLOR.shutter.length]);
    // У барака одно окно заколочено двумя досками
    if (barrack && i === 2) for (const dy of [0.03, 0.08]) part(t, y + dy, 0.016, WIN_W + 0.03, 0.02, 0.008, pick(PALETTE.planks, v + 2));
    else light(s, 'window', t, y, WIN_W, WIN_H, v * 5.7 + i * 2.3, LIGHT_WINDOW, 1);
  });

  // Заплаты барака: доски другого тона и лист железа на стенах
  if (barrack) {
    on(sides[0])(-w * 0.05, PLINTH + 0.03, 0.004, 0.12, 0.1, 0.008, pick(PALETTE.planks, v + 1));
    on(sides[2])(d * 0.15, PLINTH + 0.12, 0.004, 0.14, 0.12, 0.008, COLOR.sheet);
    on(sides[1])(-w * 0.1, PLINTH + 0.02, 0.004, 0.18, 0.08, 0.008, pick(PALETTE.planks, v + 2));
  }

  // Дверь по центру фасада, ступень, козырёк
  const front = (t: number, y: number, out: number, st: number, sy: number, sn: number, color: number) =>
    box(t, y, d / 2 + out + sn / 2, st, sy, sn, color);
  front(0, PLINTH, -0.006, 0.12, 0.21, 0.012, paint.frame);
  front(0, PLINTH, 0, 0.1, 0.2, 0.01, COLOR.door);
  front(0, 0, 0, 0.18, PLINTH, 0.07, COLOR.plinth);
  if (veranda) {
    // Веранда вдоль фасада: настил, столбики, навес
    front(0, 0, 0, w, PLINTH, 0.14, pick(PALETTE.planks, v));
    for (const t of [-w / 2 + 0.02, 0.1, -0.1, w / 2 - 0.02]) front(t, PLINTH, 0.12, 0.014, 0.21, 0.014, COLOR.trim);
    front(0, PLINTH + 0.21, -0.01, w + 0.02, 0.014, 0.16, roof);
  } else front(0, PLINTH + 0.22, -0.01, 0.2, 0.012, 0.08, barrack ? COLOR.sheet : roof);
  light(sides[0], 'window', 0, PLINTH + 0.21, 0.04, 0.03, v * 4.1, LIGHT_WINDOW, 1);

  // Крутая двускатная крыша, конёк вдоль фасада
  const [ax, az] = o.at(u0, f0), [bx] = o.at(u0 + 1, f0);
  const ridgeX = Math.abs(bx - ax) > 0.5;
  const su = w + 2 * EAVE, sf = d + 2 * EAVE;
  g.gable(ax, y0 + top, az, ridgeX ? su : sf, RISE, ridgeX ? sf : su, roof, siding, !ridgeX);
  if (!barrack) {
    // Мансардное окно на переднем скате: стенка с окном там, где скат на высоте её низа,
    // и свой маленький конёк поперёк
    const dw = 0.14, dh = 0.11, dy = top + RISE * 0.25, df = (sf / 2) * 0.75 - 0.05;
    box(0, dy, df, dw, dh, 0.1, siding);
    windowAt(on({ nu: 0, nf: 1, len: dw, half: df + 0.05, turn: 0 }), 0, dy + 0.02, 0.07, 0.07, paint);
    const [mx, mz] = o.at(u0, f0 + df);
    g.gable(mx, y0 + dy + dh, mz, ridgeX ? dw + 0.02 : 0.12, 0.06, ridgeX ? 0.12 : dw + 0.02, roof, siding, ridgeX);
  }
  // Труба
  const cu = (hash(v, 7) > 0.5 ? 1 : -1) * w * 0.3;
  box(cu, top + RISE * 0.3, -d * 0.1, 0.05, RISE * 0.9, 0.05, barrack ? COLOR.sheet : COLOR.chimney, COLOR.plinth);
}
