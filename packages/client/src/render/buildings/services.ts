// Рецепты зданий служб (plan.md 010, этап 5): школа - двухэтажный кирпичный корпус с большими
// окнами и выступающим центральным входом (пилястры, парапет-фронтон, часы, табличка), лазарет -
// белый корпус с лентами окон, красными крестами и козырьком над входом. Детали - parts.ts.
// Фасад - к +f в осях здания.

import type { GeoBuilder } from '../builder';
import { houseKit, M, sidesOf, windowAt, type Frame } from './parts';

const PLINTH = 0.5 * M;
const LIGHT_WINDOW = 0xffd9a0;

const COLOR = {
  brick: 0x9c4e3b,
  stone: 0xd8cdb8,
  plinth: 0x7a716a,
  frame: 0xece6da,
  glass: 0x3d4b57,
  roof: 0x4a4744,
  door: 0x5a3d2a,
  metal: 0x57524d,
  white: 0xeef0ec,
  band: 0x46596a,
  cross: 0xc8322b,
  sign: 0x2f6f8f,
};

/** Школа w x d: два высоких этажа, окна по 1.6 м, ризалит входа по центру фасада. */
export function schoolBuilding(g: GeoBuilder, o: Frame, u0: number, f0: number, y0: number, w: number, d: number, seed: number) {
  const { box, part: on, light } = houseKit(g, o, u0, f0, y0);
  const sides = sidesOf(w, d);
  const FLOOR = 3.6 * M, floors = 2;
  const top = PLINTH + floors * FLOOR;
  const paint = { frame: COLOR.frame, glass: COLOR.glass, stone: COLOR.stone };

  box(0, 0, 0, w + 0.01, PLINTH, d + 0.01, COLOR.plinth);
  box(0, PLINTH, 0, w, floors * FLOOR, d, COLOR.brick, COLOR.roof);
  box(0, PLINTH + FLOOR - 0.012, 0, w + 0.025, 0.022, d + 0.025, COLOR.stone);
  box(0, top - 0.035, 0, w + 0.06, 0.045, d + 0.06, COLOR.stone, COLOR.roof);
  for (const s of [-1, 1]) {
    box(0, top + 0.01, s * (d / 2 + 0.015), w + 0.06, 0.06, 0.03, COLOR.brick, COLOR.stone);
    box(s * (w / 2 + 0.015), top + 0.01, 0, 0.03, 0.06, d, COLOR.brick, COLOR.stone);
  }
  // Окна классов: широкие, с переплётом в три створки
  const entry = 0.42;
  sides.forEach((s, si) => {
    const part = on(s);
    const n = Math.max(1, Math.floor(s.len / (3.2 * M)));
    const step = s.len / n;
    for (let i = 0; i < n; i++) {
      const t = -s.len / 2 + step * (i + 0.5);
      if (si === 0 && Math.abs(t) < entry / 2 + 0.06) continue;
      for (let fl = 0; fl < floors; fl++) {
        const y = PLINTH + fl * FLOOR + 0.9 * M;
        windowAt(part, t, y, 1.6 * M, 2.0 * M, paint);
        part(t - 0.053, y, 0.006, 0.01, 2.0 * M - 0.02, 0.012, COLOR.frame);
        part(t + 0.053, y, 0.006, 0.01, 2.0 * M - 0.02, 0.012, COLOR.frame);
        light(s, 'window', t, y, 1.6 * M, 2.0 * M, seed + si * 13.1 + i * 2.3 + fl * 0.7, LIGHT_WINDOW, 2);
      }
    }
  });
  // Ризалит входа: выступ на всю высоту, пилястры, парапет выше крыши с часами
  const front = on(sides[0]);
  box(0, PLINTH, d / 2 + 0.04, entry, floors * FLOOR, 0.08, COLOR.brick, COLOR.roof);
  for (const e of [-1, 1]) box(e * (entry / 2 - 0.02), PLINTH, d / 2 + 0.085, 0.04, floors * FLOOR, 0.015, COLOR.stone);
  box(0, top - 0.035, d / 2 + 0.04, entry + 0.04, 0.045, 0.1, COLOR.stone, COLOR.roof);
  box(0, top + 0.01, d / 2 + 0.075, entry, 0.12, 0.03, COLOR.brick, COLOR.stone);
  box(0, top + 0.13, d / 2 + 0.075, entry * 0.5, 0.05, 0.03, COLOR.brick, COLOR.stone);
  front(0, top + 0.035, 0.092, 0.08, 0.08, 0.008, COLOR.frame); // циферблат
  front(0, top + 0.07, 0.097, 0.006, 0.035, 0.004, COLOR.metal);
  // Двустворчатая дверь, окно над ней, табличка, ступени и козырёк
  front(0, PLINTH, 0.082, 0.2, 0.26, 0.012, COLOR.stone);
  for (const e of [-1, 1]) front(e * 0.045, PLINTH, 0.09, 0.085, 0.24, 0.008, COLOR.door);
  windowAt(on({ ...sides[0], half: sides[0].half + 0.08 }), 0, PLINTH + FLOOR + 0.9 * M, 1.6 * M, 2.0 * M, paint);
  front(0, PLINTH + 0.3, 0.084, 0.26, 0.05, 0.012, COLOR.sign);
  front(0, PLINTH + 0.27, 0.13, 0.3, 0.02, 0.1, COLOR.roof);
  front(0, 0, 0.14, 0.34, PLINTH, 0.12, COLOR.stone);
  front(0, 0, 0.21, 0.38, PLINTH / 2, 0.06, COLOR.stone);
}

/** Лазарет w x d: белый корпус в два этажа, ленты окон, кресты на фасаде и крыше, козырёк входа. */
export function clinicBuilding(g: GeoBuilder, o: Frame, u0: number, f0: number, y0: number, w: number, d: number, seed: number) {
  const { box, part: on, light } = houseKit(g, o, u0, f0, y0);
  const sides = sidesOf(w, d);
  const FLOOR = 3.3 * M, floors = 2;
  const top = PLINTH + floors * FLOOR;

  box(0, 0, 0, w + 0.01, PLINTH, d + 0.01, COLOR.plinth);
  box(0, PLINTH, 0, w, floors * FLOOR, d, COLOR.white, COLOR.roof);
  box(0, top - 0.03, 0, w + 0.05, 0.04, d + 0.05, COLOR.stone, COLOR.roof);
  for (const s of [-1, 1]) {
    box(0, top + 0.01, s * (d / 2 + 0.01), w + 0.05, 0.05, 0.03, COLOR.white);
    box(s * (w / 2 + 0.01), top + 0.01, 0, 0.03, 0.05, d, COLOR.white);
  }
  // Ленты окон этажей с пилонами; на фасаде лента разрывается входом
  sides.forEach((s, si) => {
    const part = on(s);
    for (let fl = 0; fl < floors; fl++) {
      const y = PLINTH + fl * FLOOR + 0.1;
      const runs: [number, number][] = si === 0 && fl === 0 ? [[-s.len / 2 + 0.06, -0.2], [0.2, s.len / 2 - 0.06]] : [[-s.len / 2 + 0.06, s.len / 2 - 0.06]];
      for (const [a, b] of runs) {
        const len = b - a, c = (a + b) / 2;
        part(c, y - 0.01, 0, len + 0.02, 0.14, 0.012, COLOR.stone);
        part(c, y, 0.006, len, 0.12, 0.008, COLOR.band);
        for (let k = 1; k < Math.round(len / 0.12); k++) part(a + (len * k) / Math.round(len / 0.12), y, 0.008, 0.012, 0.12, 0.012, COLOR.white);
        light(s, 'window', c, y, len, 0.12, seed + si * 7.7 + fl * 3.1 + a, LIGHT_WINDOW, 2);
      }
    }
  });
  // Вход: стеклянные двери, козырёк на столбах, пандус; красный крест над входом
  const front = on(sides[0]);
  front(0, PLINTH, 0.006, 0.26, 0.24, 0.01, COLOR.band);
  front(0, PLINTH + 0.27, 0.11, 0.5, 0.025, 0.22, COLOR.stone);
  for (const e of [-1, 1]) front(e * 0.23, 0, 0.2, 0.025, PLINTH + 0.27, 0.025, COLOR.metal);
  front(0, 0, 0.11, 0.44, PLINTH, 0.2, COLOR.stone);
  front(0, PLINTH + FLOOR + 0.12, 0.006, 0.12, 0.04, 0.01, COLOR.cross);
  front(0, PLINTH + FLOOR + 0.08, 0.006, 0.04, 0.12, 0.01, COLOR.cross);
  // Крест на крыше - виден сверху
  box(0, top, 0, 0.42, 0.012, 0.13, COLOR.cross);
  box(0, top, 0, 0.13, 0.012, 0.42, COLOR.cross);
  box(w * 0.32, top, -d * 0.25, 0.14, 0.07, 0.12, 0x9a958c);
}
