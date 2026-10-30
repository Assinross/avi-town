// Рецепт: двухэтажный жилой дом (участок R2) - обшивка пастельного цвета, светлые угловые доски,
// окна с рамами и у части вариантов ставнями, двускатная крыша со свесами и трубой,
// крыльцо с навесом на столбиках. Фасад - к улице (+f в осях участка).

import * as THREE from 'three';
import type { GeoBuilder } from '../builder';
import { hash, houseKit, sidesOf, windowAt, type Frame } from './parts';

const PLINTH = 0.04;
const FLOOR = 0.28;
const WIN_W = 0.1, WIN_H = 0.13, SILL_Y = 0.08;
const BAY = 0.24;
const RISE = 0.22;
const EAVE = 0.04;

const COLOR = {
  siding: [0xd9cdb4, 0x9fb5c4, 0xc9b08a, 0xa9b89a, 0xe3ddd0] as const,
  roof: [0x5b5f66, 0x7a3b2e, 0x4f6b55, 0x6b5a4c] as const,
  shutter: [0x3f5f4a, 0x3d5670, 0x7a3b32] as const,
  trim: 0xf0ebe0,
  plinth: 0x7a716a,
  glass: 0x3d4b57,
  door: 0x5a3a28,
  chimney: 0x8c4a3a,
};
const LIGHT_WINDOW = 0xffd9a0;

/** Двухэтажный дом w x d (в клетках) с центром основания (u0, f0) на высоте y0; v - вариант. */
export function twoStoreyHouse(g: GeoBuilder, o: Frame, v: number, u0: number, f0: number, y0: number, w: number, d: number) {
  const siding = COLOR.siding[v % COLOR.siding.length];
  const roof = COLOR.roof[(v >> 1) % COLOR.roof.length];
  const shutters = v % 2 === 0;
  const shutter = COLOR.shutter[v % COLOR.shutter.length];
  const paint = { frame: COLOR.trim, glass: COLOR.glass, stone: COLOR.trim };
  const { box, part: on, light } = houseKit(g, o, u0, f0, y0);
  const top = PLINTH + 2 * FLOOR;

  box(0, 0, 0, w + 0.01, PLINTH, d + 0.01, COLOR.plinth);
  box(0, PLINTH, 0, w, 2 * FLOOR, d, siding);
  // Пояс между этажами и подшивка под свесом крыши
  box(0, PLINTH + FLOOR - 0.008, 0, w + 0.012, 0.016, d + 0.012, COLOR.trim);
  box(0, top - 0.018, 0, w + 0.02, 0.018, d + 0.02, COLOR.trim);

  sidesOf(w, d).forEach((s, si) => {
    const part = on(s);
    // Угловые доски
    if (s.nf) for (const e of [-1, 1]) part(e * (s.len / 2 - 0.008), PLINTH, 0.004, 0.02, 2 * FLOOR, 0.012, COLOR.trim);
    const n = Math.max(1, Math.floor(s.len / BAY));
    const step = s.len / n;
    for (let i = 0; i < n; i++) {
      const t = -s.len / 2 + step * (i + 0.5);
      for (let fl = 0; fl < 2; fl++) {
        // Дверь с крыльцом по центру фасада вместо окна первого этажа
        if (si === 0 && fl === 0 && Math.abs(t) < step * 0.6) continue;
        const y = PLINTH + fl * FLOOR + SILL_Y;
        windowAt(part, t, y, WIN_W, WIN_H, paint);
        if (shutters && si === 0) for (const e of [-1, 1]) part(t + e * (WIN_W / 2 + 0.03), y, 0.004, 0.04, WIN_H, 0.01, shutter);
        light(s, 'window', t, y, WIN_W, WIN_H, v * 6.7 + si * 29.1 + i * 3.71 + fl * 1.37, LIGHT_WINDOW, 2);
      }
    }
  });

  // Крыльцо: настил, две ступени, дверь, навес на двух столбиках
  const front = (t: number, y: number, out: number, st: number, sy: number, sn: number, color: number, topColor = color) =>
    box(t, y, d / 2 + out + sn / 2, st, sy, sn, color, topColor);
  front(0, 0, 0, 0.3, PLINTH, 0.14, COLOR.trim);
  front(0, 0, 0.14, 0.18, PLINTH / 2, 0.05, COLOR.trim);
  front(0, PLINTH, -0.006, 0.12, 0.21, 0.012, COLOR.trim);
  front(0, PLINTH, 0, 0.1, 0.2, 0.01, COLOR.door);
  for (const e of [-1, 1]) front(e * 0.13, PLINTH, 0.12, 0.014, 0.22, 0.014, COLOR.trim);
  front(0, PLINTH + 0.22, -0.01, 0.32, 0.014, 0.16, roof);
  light(sidesOf(w, d)[0], 'window', 0, PLINTH + 0.21, 0.04, 0.03, v * 4.3, LIGHT_WINDOW, 1);

  // Двускатная крыша: конёк вдоль фасада, свесы со всех сторон
  const [ax, az] = o.at(u0, f0), [bx] = o.at(u0 + 1, f0);
  const ridgeX = Math.abs(bx - ax) > 0.5;
  const su = w + 2 * EAVE, sf = d + 2 * EAVE;
  g.gable(ax, y0 + top, az, ridgeX ? su : sf, RISE, ridgeX ? sf : su, roof, siding, !ridgeX);
  // Труба у конька, сбоку от середины
  const cu = (hash(v, 3) > 0.5 ? 1 : -1) * w * 0.28, cf = -d * 0.12;
  box(cu, top + RISE * 0.3, cf, 0.06, RISE * 0.85, 0.06, COLOR.chimney, COLOR.plinth);
  const [cx, cz] = o.at(u0 + cu, f0 + cf);
  g.cylinder(new THREE.Matrix4().makeTranslation(cx, y0 + top + RISE * 1.15, cz), 0.018, 0.03, COLOR.plinth, 6, COLOR.plinth, 0.018);
}
