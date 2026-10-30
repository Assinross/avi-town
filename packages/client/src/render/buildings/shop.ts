// Рецепт: лавка или кафе (участок C1) - одноэтажный дом с витриной во весь фасад, стеклянной
// дверью, полосатой маркизой, вывеской, плоской крышей с парапетом и кондиционером.
// Цвета стен и отделки - как у прежних лавок (shopPaint). Фасад - к улице (+f в осях участка).

import * as THREE from 'three';
import type { GeoBuilder } from '../builder';
import { houseKit, sidesOf, windowAt, type Frame } from './parts';

const PLINTH = 0.03;
const WALL = 0.4;
const SHOP_LOW = 0.05, SHOP_HIGH = 0.28;
const AWNING = [0xb8433a, 0x2f6f8f, 0x3f7f4f, 0xc9973a] as const;
const STRIPE = 0xf2ede2;

const COLOR = {
  plinth: 0x7a716a,
  glass: 0x46596a,
  roof: 0x4a4744,
  metal: 0x57524d,
  door: 0x4a3426,
};
const LIGHT_SHOP = 0xfff2cc;
const LIGHT_WINDOW = 0xffd9a0;

/** Лавка w x d (в клетках) с центром основания (u0, f0) на высоте y0; wall/trim - цвета стен и отделки. */
export function shopFront(g: GeoBuilder, o: Frame, v: number, u0: number, f0: number, y0: number, w: number, d: number, wall: number, trim: number) {
  const { box, part: on, light } = houseKit(g, o, u0, f0, y0);
  const sides = sidesOf(w, d);
  const front = on(sides[0]);
  const top = PLINTH + WALL;
  const awning = AWNING[v % AWNING.length];

  box(0, 0, 0, w + 0.01, PLINTH, d + 0.01, COLOR.plinth);
  box(0, PLINTH, 0, w, WALL, d, wall, COLOR.roof);
  // Карниз и парапет
  box(0, top - 0.02, 0, w + 0.03, 0.03, d + 0.03, trim, COLOR.roof);
  for (const s of [-1, 1]) {
    box(0, top + 0.01, s * d / 2, w + 0.03, 0.04, 0.025, trim);
    box(s * (w / 2), top + 0.01, 0, 0.025, 0.04, d, trim);
  }
  // Кондиционер и люк на крыше
  box(-w * 0.2, top + 0.01, -d * 0.15, 0.1, 0.05, 0.08, 0x9a958c);
  box(w * 0.22, top + 0.01, -d * 0.2, 0.07, 0.02, 0.07, COLOR.metal);

  // Витрина: от левого края до двери, переплёты через ~1 м; дверь справа
  const doorT = w / 2 - 0.13;
  const v0 = -w / 2 + 0.05, v1 = doorT - 0.08;
  const vw = v1 - v0, vc = (v0 + v1) / 2;
  front(vc, PLINTH + SHOP_LOW - 0.012, 0, vw + 0.025, SHOP_HIGH - SHOP_LOW + 0.024, 0.014, trim);
  front(vc, PLINTH + SHOP_LOW, 0.007, vw - 0.01, SHOP_HIGH - SHOP_LOW, 0.008, COLOR.glass);
  const panes = Math.max(2, Math.round(vw / 0.1));
  for (let i = 1; i < panes; i++) front(v0 + (vw * i) / panes, PLINTH + SHOP_LOW, 0.008, 0.01, SHOP_HIGH - SHOP_LOW, 0.012, trim);
  front(vc, PLINTH + SHOP_LOW - 0.018, 0, vw + 0.035, 0.012, 0.035, trim);
  light(sides[0], 'shopwindow', vc, PLINTH + SHOP_LOW, vw, SHOP_HIGH - SHOP_LOW, v * 6.3, LIGHT_SHOP, 1);
  // Стеклянная дверь в раме
  front(doorT, PLINTH, 0, 0.12, 0.24, 0.014, trim);
  front(doorT, PLINTH, 0.007, 0.09, 0.22, 0.008, COLOR.glass);
  front(doorT, PLINTH + 0.11, 0.012, 0.09, 0.012, 0.008, COLOR.door);

  // Вывеска над маркизой: доска и светлое поле надписи
  front(0, PLINTH + 0.32, 0, w * 0.86, 0.06, 0.02, awning);
  front(-0.03, PLINTH + 0.335, 0.01, w * 0.5, 0.03, 0.006, STRIPE);

  // Маркиза: полосы наклоном от стены вниз-наружу, по краю - подзор
  const len = 0.17, tilt = Math.atan2(0.94, -0.36);
  const stripes = 8, sw = (w * 0.9) / stripes;
  for (let i = 0; i < stripes; i++) {
    const t = -w * 0.45 + sw * (i + 0.5);
    const [x, z] = o.at(u0 + t, f0 + d / 2 + 0.005);
    const m = new THREE.Matrix4().makeTranslation(x, y0 + PLINTH + 0.31, z)
      .multiply(new THREE.Matrix4().makeRotationY(-o.rot))
      .multiply(new THREE.Matrix4().makeRotationX(tilt));
    const c = i % 2 ? STRIPE : awning;
    g.boxM(m, sw, len, 0.008, c);
    const edge = m.clone().multiply(new THREE.Matrix4().makeTranslation(0, len, 0)).multiply(new THREE.Matrix4().makeRotationX(-tilt + Math.PI));
    g.boxM(edge, sw, 0.035, 0.006, c);
  }

  // Окошки сбоку и сзади, задняя дверь
  const paint = { frame: trim, glass: COLOR.glass, stone: trim };
  for (const si of [2, 3]) {
    windowAt(on(sides[si]), 0, PLINTH + 0.14, 0.1, 0.12, paint);
    light(sides[si], 'window', 0, PLINTH + 0.14, 0.1, 0.12, v * 3.9 + si, LIGHT_WINDOW, 1);
  }
  on(sides[1])(w * 0.25, PLINTH, 0, 0.1, 0.22, 0.014, COLOR.door);
}
