// Рецепт: кирпичный дом без лифта, 3-5 этажей (reference.md, раздел 2) - первый образец
// генератора зданий этапа 5. Всё объёмом, не текстурой: цоколь, кирпичные стены, окна с рамой,
// переплётом, подоконником и перемычкой, карнизы между этажами и под крышей, плоская крыша
// с парапетом, выход на крышу, трубы, водяной бак, подъезд с порталом и козырьком, водостоки,
// наружная пожарная лестница, телевизионная антенна, кондиционеры и мурал на глухом торце.
// Размеры - в клетках (клетка ~10 м, M = 0.1 на метр). Фасад - к улице (+f в осях участка).

import * as THREE from 'three';
import type { GeoBuilder } from '../builder';
import { airConditioner, hash, houseKit, M, sidesOf, windowAt, type Frame, type Side } from './parts';

const FLOOR = 3.1 * M;
const PLINTH = 0.6 * M;
const WIN_W = 1.2 * M, WIN_H = 1.6 * M, SILL_Y = 0.9 * M;
/** Шаг окон по фасаду. */
const BAY = 2.9 * M;

const COLOR = {
  brick: [0x9c4e3b, 0xa65d40, 0x8c4838] as const,
  stone: 0xd8cdb8,
  plinth: 0x7a716a,
  frame: 0xece6da,
  glass: 0x3d4b57,
  roof: 0x4a4744,
  door: 0x4a3426,
  metal: 0x57524d,
  pipe: 0x8a8580,
  tank: 0x9a8d7c,
};
const LIGHT_WINDOW = 0xffd9a0;

/** Солнце и холмы из плоских фигур поверх кирпича, под выступающими карнизами. */
function paintMural(g: GeoBuilder, o: Frame, s: Side, u0: number, f0: number, y0: number, height: number, v: number) {
  const [sun, far, near, meadow] = v % 2
    ? [0xe9ae58, 0x7da497, 0x457d76, 0x325f62]
    : [0xe7b66f, 0xc38b73, 0x98687a, 0x6c586f];
  const paint = (points: [number, number][], color: number, out: number) => {
    // Рисунок читается слева направо с обеих сторон дома.
    const vertices = points.map(([t, y]) => {
      const [x, z] = o.at(u0 + s.nu * (s.half + out), f0 - s.nu * t * s.len);
      return new THREE.Vector3(x, y0 + y * height, z);
    });
    g.face(vertices, color);
  };
  const sunRadius = Math.min(s.len * 0.19, height * 0.13);
  paint(Array.from({ length: 12 }, (_, i): [number, number] => {
    const angle = i * Math.PI / 6;
    return [0.13 + Math.cos(angle) * sunRadius / s.len, 0.76 + Math.sin(angle) * sunRadius / height];
  }), sun, 0.002);
  paint([[-0.43, 0.16], [0.44, 0.16], [0.44, 0.36], [-0.18, 0.67]], far, 0.002);
  paint([[-0.43, 0.15], [0.44, 0.15], [0.44, 0.34], [0.2, 0.56], [-0.43, 0.29]], near, 0.003);
  paint([[-0.43, 0.12], [0.44, 0.12], [0.44, 0.24], [-0.26, 0.28], [-0.43, 0.23]], meadow, 0.004);
}

/**
 * Кирпичный дом шириной w и глубиной d (в клетках) с центром основания (u0, f0) в осях участка,
 * на высоте y0. Вариант v выбирает этажность, оттенок кирпича, балконы, бак,
 * сторону пожарной лестницы и форму антенны.
 */
export function brickHouse(g: GeoBuilder, o: Frame, v: number, u0: number, f0: number, y0: number, w: number, d: number) {
  const floors = 3 + (v % 3);
  const brick = COLOR.brick[v % COLOR.brick.length];
  const balconies = v % 3 !== 0;
  const { box, part: on, light } = houseKit(g, o, u0, f0, y0);
  const base = PLINTH;
  const top = base + floors * FLOOR;
  const escapeSide = v % 2 ? 2 : 3;
  const muralSide = v % 5 === 4 ? (escapeSide === 2 ? 3 : 2) : -1;

  // Цоколь, стены (верх стен - кровля), карнизы между этажами
  box(0, 0, 0, w + 0.01, base, d + 0.01, COLOR.plinth);
  box(0, base, 0, w, floors * FLOOR, d, brick, COLOR.roof);
  for (let i = 1; i < floors; i++) box(0, base + i * FLOOR - 0.012, 0, w + 0.025, 0.02, d + 0.025, COLOR.stone);
  // Венчающий карниз (его верх - кровля) и парапет с камнем по верху
  box(0, top - 0.03, 0, w + 0.06, 0.04, d + 0.06, COLOR.stone, COLOR.roof);
  const p = 0.03, ph = 0.06;
  for (const s of [-1, 1]) {
    box(0, top + 0.01, s * (d / 2 + 0.03 - p / 2), w + 0.06, ph, p, brick, COLOR.stone);
    box(s * (w / 2 + 0.03 - p / 2), top + 0.01, 0, p, ph, d + 0.06 - 2 * p, brick, COLOR.stone);
  }

  const sides = sidesOf(w, d);
  sides.forEach((s, si) => {
    if (si === muralSide) {
      paintMural(g, o, s, u0, f0, y0 + base, top - base, v);
      return;
    }
    const part = on(s);
    const n = Math.max(1, Math.floor(s.len / BAY));
    const step = s.len / n;
    for (let i = 0; i < n; i++) {
      const t = -s.len / 2 + step * (i + 0.5);
      for (let fl = 0; fl < floors; fl++) {
        // Подъезд по центру фасада вместо окна первого этажа
        if (si === 0 && fl === 0 && Math.abs(t) < step * 0.6) continue;
        const y = base + fl * FLOOR + SILL_Y;
        windowAt(part, t, y, WIN_W, WIN_H, COLOR);
        // Балконы на фасаде через окно со второго этажа
        const balcony = balconies && si === 0 && fl > 0 && i % 2 === 1;
        if (balcony) {
          const by = base + fl * FLOOR;
          part(t, by, 0.06, WIN_W + 0.08, 0.012, 0.12, COLOR.stone);
          part(t, by + 0.012, 0.115, WIN_W + 0.08, 0.07, 0.008, COLOR.metal);
          for (const e of [-1, 1]) part(t + e * (WIN_W / 2 + 0.036), by + 0.012, 0.06, 0.008, 0.07, 0.12, COLOR.metal);
        }
        if (fl > 0 && si < 2 && !balcony && (v + si + i * 3 + fl * 2) % 5 === 0) airConditioner(part, t, y);
        light(s, 'window', t, y, WIN_W, WIN_H, v * 7.9 + si * 31.3 + i * 3.71 + fl * 1.37, LIGHT_WINDOW, 3);
      }
    }
    // Водостоки по углам этой стороны
    if (s.nf) for (const e of [-1, 1]) part(e * (s.len / 2 - 0.012), 0, 0.01, 0.014, top, 0.014, COLOR.pipe);
  });

  // Пожарная лестница у заднего угла торца: не закрывает окна и не выходит на фасад.
  // Стойки продолжаются над парапетом, чтобы был виден выход на крышу.
  const escape = on(sides[escapeSide]);
  const t = -d / 2 + 0.075, ladderBase = base + 0.04, ladderTop = top + 0.15;
  for (const e of [-1, 1]) {
    escape(t + e * 0.045, ladderBase, 0.06, 0.008, ladderTop - ladderBase, 0.008, COLOR.metal);
    for (let fl = 0; fl <= floors; fl++) {
      escape(t + e * 0.045, base + fl * FLOOR + 0.025, 0.03, 0.008, 0.008, 0.06, COLOR.metal);
    }
  }
  for (let y = ladderBase + 0.035; y < ladderTop; y += 0.035) {
    escape(t, y, 0.06, 0.09, 0.007, 0.008, COLOR.pipe);
  }

  // Подъезд: каменный портал, дверь, козырёк, две ступени
  const front = (t: number, y: number, out: number, st: number, sy: number, sn: number, color: number) =>
    box(t, y, d / 2 + out + sn / 2, st, sy, sn, color);
  front(0, base, -0.01, 0.24, 0.29, 0.03, COLOR.stone);
  front(0, base, 0.015, 0.15, 0.23, 0.012, COLOR.door);
  front(0, base + 0.235, 0.015, 0.15, 0.04, 0.008, COLOR.glass);
  front(0, base + 0.3, 0, 0.34, 0.015, 0.16, COLOR.metal);
  front(0, 0, 0, 0.34, base * 0.66, 0.1, COLOR.stone);
  front(0, 0, 0.1, 0.34, base * 0.33, 0.07, COLOR.stone);
  const [lx, lz] = o.at(u0, f0 + d / 2 + 0.03);
  g.light('window', lx, y0 + base + 0.32, lz, o.rot, v * 5.1, LIGHT_WINDOW, 0.1, 0.06, 1);

  // Крыша: выход на крышу, вентиляция, трубы и у части домов - водяной бак на опорах
  const r = top + 0.01;
  box(-w * 0.22, r, -d * 0.1, 0.26, 0.2, 0.22, brick, COLOR.roof);
  box(w * 0.3, r, d * 0.22, 0.08, 0.06, 0.08, COLOR.metal);
  box(w * 0.05, r, -d * 0.28, 0.1, 0.05, 0.06, COLOR.metal);
  for (const e of [-1, 1]) box(e * (w / 2 - 0.12), r, -d * 0.3, 0.06, 0.16 + hash(v, e) * 0.06, 0.05, brick, COLOR.plinth);
  if (v % 2 === 1) {
    const tu = w * 0.18, tf = -d * 0.05, legs = 0.12;
    for (const [a, b] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) box(tu + a * 0.07, r, tf + b * 0.07, 0.015, legs, 0.015, COLOR.metal);
    const [x, z] = o.at(u0 + tu, f0 + tf);
    const m = new THREE.Matrix4().makeTranslation(x, y0 + r + legs, z);
    g.cylinder(m, 0.1, 0.16, COLOR.tank, 10, COLOR.tank, 0.1);
    g.cylinder(m.clone().multiply(new THREE.Matrix4().makeTranslation(0, 0.16, 0)), 0.105, 0.05, COLOR.metal, 10, COLOR.metal, 0.02);
  }

  // Антенна на отдельной опоре: мачта, траверса и поперечные элементы разной длины.
  const au = w * 0.32, af = -d * 0.18;
  const mast = 0.32 + hash(v, 17) * 0.1;
  box(au, r, af, 0.055, 0.025, 0.055, COLOR.plinth);
  box(au, r + 0.025, af, 0.008, mast, 0.008, COLOR.pipe);
  const antenna = (u: number, f: number, su: number, sf: number) => {
    const along = v % 2 === 0;
    box(au + (along ? u : f), r + mast, af + (along ? f : u), along ? su : sf, 0.007, along ? sf : su, COLOR.pipe);
  };
  antenna(0, 0, 0.26, 0.007);
  for (let i = 0; i < 4; i++) antenna(-0.09 + i * 0.06, 0, 0.006, 0.18 - i * 0.025);
}
