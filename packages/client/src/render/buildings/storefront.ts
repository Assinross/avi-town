// Рецепты торговли C2-C3 (spec 010 US5, таблица типов): дом с магазинами в первом этаже - внизу
// ряд лавок, у каждой витрина, стеклянная дверь, своя полосатая маркиза и вывеска, выше - жилые
// этажи с окнами и карнизами, плоская крыша с парапетом; и универмаг - два высоких этажа с лентами
// окон, широкий вход под козырьком, вывеска на крыше. Фасад - к улице (+f в осях участка).
// Детали - те же, что у лавки C1 (shop.ts) и кирпичного дома (brick.ts).

import * as THREE from 'three';
import type { GeoBuilder } from '../builder';
import { houseKit, M, sidesOf, windowAt, type Frame } from './parts';

const PLINTH = 0.3 * M;
/** Торговый этаж выше жилого: витрины и вывески. */
const SHOP_FLOOR = 4.2 * M;
const FLOOR = 3.1 * M;
const WIN_W = 1.2 * M, WIN_H = 1.6 * M, SILL_Y = 0.9 * M;
const BAY = 2.9 * M;
/** Ширина одной лавки в первом этаже. */
const UNIT = 0.42;
const AWNING = [0xb8433a, 0x2f6f8f, 0x3f7f4f, 0xc9973a, 0x7a4f8f] as const;
const STRIPE = 0xf2ede2;

const COLOR = {
  plinth: 0x7a716a,
  glass: 0x46596a,
  roof: 0x4a4744,
  metal: 0x57524d,
  door: 0x4a3426,
  stone: 0xd8cdb8,
  band: 0x3d4b57,
};
const LIGHT_SHOP = 0xfff2cc;
const LIGHT_WINDOW = 0xffd9a0;

/** Полосатая маркиза шириной w над точкой t фасада на высоте y: полосы наклоном от стены, подзор. */
function awning(g: GeoBuilder, o: Frame, u0: number, fFront: number, y: number, t: number, w: number, color: number) {
  const len = 0.15, tilt = Math.atan2(0.94, -0.36);
  const stripes = Math.max(4, Math.round(w / 0.05));
  const sw = w / stripes;
  for (let i = 0; i < stripes; i++) {
    const [x, z] = o.at(u0 + t - w / 2 + sw * (i + 0.5), fFront + 0.005);
    const m = new THREE.Matrix4().makeTranslation(x, y, z)
      .multiply(new THREE.Matrix4().makeRotationY(-o.rot))
      .multiply(new THREE.Matrix4().makeRotationX(tilt));
    const c = i % 2 ? STRIPE : color;
    g.boxM(m, sw, len, 0.008, c);
    const edge = m.clone().multiply(new THREE.Matrix4().makeTranslation(0, len, 0)).multiply(new THREE.Matrix4().makeRotationX(-tilt + Math.PI));
    g.boxM(edge, sw, 0.03, 0.006, c);
  }
}

/**
 * Дом w x d (в клетках) с лавками в первом этаже и floors жилыми этажами над ними; центр основания
 * (u0, f0), высота y0. wall/trim - цвета стен и отделки, v - вариант (цвета маркиз, вывесок).
 */
export function shopHouse(g: GeoBuilder, o: Frame, v: number, u0: number, f0: number, y0: number, w: number, d: number, floors: number, wall: number, trim: number) {
  const { box, part: on, light } = houseKit(g, o, u0, f0, y0);
  const sides = sidesOf(w, d);
  const front = on(sides[0]);
  const base = PLINTH + SHOP_FLOOR;
  const top = base + floors * FLOOR;

  // Цоколь, торговый этаж в отделке, жилые этажи в цвет стен, карниз над витринами
  box(0, 0, 0, w + 0.01, PLINTH, d + 0.01, COLOR.plinth);
  box(0, PLINTH, 0, w, SHOP_FLOOR, d, trim);
  box(0, base, 0, w, floors * FLOOR, d, wall, COLOR.roof);
  box(0, base - 0.015, 0, w + 0.035, 0.03, d + 0.035, COLOR.stone);
  for (let i = 1; i < floors; i++) box(0, base + i * FLOOR - 0.01, 0, w + 0.02, 0.016, d + 0.02, COLOR.stone);
  box(0, top - 0.03, 0, w + 0.05, 0.04, d + 0.05, COLOR.stone, COLOR.roof);
  for (const s of [-1, 1]) {
    box(0, top + 0.01, s * (d / 2 + 0.01), w + 0.05, 0.05, 0.03, wall, COLOR.stone);
    box(s * (w / 2 + 0.01), top + 0.01, 0, 0.03, 0.05, d, wall, COLOR.stone);
  }
  // Надстройка выхода на крышу и кондиционеры
  box(-w * 0.25, top, -d * 0.2, 0.14, 0.09, 0.12, wall, COLOR.roof);
  box(w * 0.2, top + 0.01, -d * 0.15, 0.09, 0.045, 0.07, 0x9a958c);

  // Лавки первого этажа: витрина и дверь, маркиза своего цвета, вывеска над ней
  const units = Math.max(1, Math.round(w / UNIT));
  const uw = w / units;
  for (let i = 0; i < units; i++) {
    const c = -w / 2 + uw * (i + 0.5);
    const color = AWNING[(v + i * 3) % AWNING.length];
    const doorT = c + uw / 2 - 0.09;
    const v0 = c - uw / 2 + 0.04, v1 = doorT - 0.07;
    const vw = v1 - v0, vc = (v0 + v1) / 2;
    const low = PLINTH + 0.04, high = PLINTH + 0.27;
    front(vc, low - 0.012, 0, vw + 0.02, high - low + 0.024, 0.014, COLOR.stone);
    front(vc, low, 0.007, vw - 0.01, high - low, 0.008, COLOR.glass);
    for (let k = 1; k < Math.max(2, Math.round(vw / 0.1)); k++) {
      front(v0 + (vw * k) / Math.max(2, Math.round(vw / 0.1)), low, 0.008, 0.01, high - low, 0.012, COLOR.stone);
    }
    light(sides[0], 'shopwindow', vc, low, vw, high - low, v * 6.3 + i * 2.1, LIGHT_SHOP, 1);
    front(doorT, PLINTH, 0, 0.1, 0.24, 0.014, COLOR.stone);
    front(doorT, PLINTH, 0.007, 0.075, 0.22, 0.008, COLOR.glass);
    awning(g, o, u0, f0 + d / 2, y0 + PLINTH + 0.3, c, uw - 0.04, color);
    front(c, PLINTH + 0.33, 0, uw * 0.8, 0.055, 0.02, color);
    front(c - 0.02, PLINTH + 0.345, 0.01, uw * 0.45, 0.026, 0.006, STRIPE);
  }

  // Жилые этажи: окна по всем сторонам, на фасаде через одно - балконы на верхних этажах
  const paint = { frame: 0xece6da, glass: 0x3d4b57, stone: COLOR.stone };
  sides.forEach((s, si) => {
    const part = on(s);
    const n = Math.max(1, Math.floor(s.len / BAY));
    const step = s.len / n;
    for (let i = 0; i < n; i++) {
      const t = -s.len / 2 + step * (i + 0.5);
      for (let fl = 0; fl < floors; fl++) {
        const y = base + fl * FLOOR + SILL_Y;
        windowAt(part, t, y, WIN_W, WIN_H, paint);
        if (si === 0 && fl > 0 && (i + v) % 3 === 1) {
          const by = base + fl * FLOOR;
          part(t, by, 0.05, WIN_W + 0.06, 0.012, 0.1, COLOR.stone);
          part(t, by + 0.012, 0.095, WIN_W + 0.06, 0.06, 0.008, COLOR.metal);
        }
        light(s, 'window', t, y, WIN_W, WIN_H, v * 5.3 + si * 17.1 + i * 2.9 + fl * 1.7, LIGHT_WINDOW, 3);
      }
    }
    // Торцы и зад первого этажа - глухие, с одной дверью сзади
    if (si === 1) part(0, PLINTH, 0, 0.1, 0.22, 0.014, COLOR.door);
  });
}

/** Универмаг w x d: два высоких этажа с лентами окон, вход по центру под козырьком, вывеска на крыше. */
export function departmentStore(g: GeoBuilder, o: Frame, v: number, u0: number, f0: number, y0: number, w: number, d: number, wall: number, trim: number) {
  const { box, part: on, light } = houseKit(g, o, u0, f0, y0);
  const sides = sidesOf(w, d);
  const front = on(sides[0]);
  const H = 0.42;
  const top = PLINTH + 2 * H;
  const sign = AWNING[v % AWNING.length];

  box(0, 0, 0, w + 0.01, PLINTH, d + 0.01, COLOR.plinth);
  box(0, PLINTH, 0, w, 2 * H, d, wall, COLOR.roof);
  box(0, top - 0.03, 0, w + 0.05, 0.045, d + 0.05, trim, COLOR.roof);
  for (const s of [-1, 1]) {
    box(0, top + 0.015, s * (d / 2 + 0.01), w + 0.05, 0.05, 0.03, trim);
    box(s * (w / 2 + 0.01), top + 0.015, 0, 0.03, 0.05, d, trim);
  }
  // На крыше - вентиляция и короба
  for (const [u, f] of [[-0.3, -0.2], [0.25, -0.1], [0.05, -0.3]] as const) box(w * u, top, d * f, 0.12, 0.06, 0.09, 0x9a958c);

  // Ленты окон: первый этаж - витрина почти во всю стену, второй - узкая лента; пилоны между
  sides.forEach((s, si) => {
    const part = on(s);
    const bands: [number, number][] = [[PLINTH + 0.06, 0.28], [PLINTH + H + 0.12, 0.16]];
    bands.forEach(([y, h], k) => {
      // Сзади и с торцов - только верхняя лента
      if (si !== 0 && k === 0) return;
      part(0, y - 0.012, 0, s.len - 0.08, h + 0.024, 0.012, trim);
      part(0, y, 0.006, s.len - 0.1, h, 0.008, COLOR.band);
      const n = Math.max(2, Math.round(s.len / 0.22));
      for (let i = 1; i < n; i++) part(-s.len / 2 + 0.05 + ((s.len - 0.1) * i) / n, y, 0.008, 0.025, h, 0.014, trim);
      light(s, k === 0 ? 'shopwindow' : 'window', 0, y, s.len - 0.1, h, v * 4.1 + si * 9.7 + k, k === 0 ? LIGHT_SHOP : LIGHT_WINDOW, k + 1);
    });
  });
  // Вход: стеклянные двери, козырёк на всю ширину входа, ступени
  front(0, PLINTH, 0.01, 0.34, 0.26, 0.012, COLOR.glass);
  front(0, PLINTH + 0.29, 0.07, 0.46, 0.025, 0.14, trim);
  front(0, 0, 0.09, 0.5, PLINTH, 0.12, COLOR.stone);
  // Вывеска на крыше над входом: доска на стойках и светлое поле
  front(0, top + 0.04, -0.03, 0.62, 0.12, 0.03, sign);
  front(0, top + 0.065, -0.012, 0.48, 0.07, 0.006, STRIPE);
  for (const e of [-1, 1]) front(e * 0.24, top, -0.05, 0.015, 0.05, 0.015, COLOR.metal);
}
