// Рецепты промзоны (spec 010 US5, таблица типов): кирпичная мастерская с воротами-роллетой,
// склад из профнастила с погрузочной рампой и цех с пилообразной крышей и кирпичной трубой.
// Детали - как у домов (parts.ts): коробки в осях здания, окна с переплётом, ночные огни.
// Фасад - к улице (+f в осях участка).

import * as THREE from 'three';
import type { GeoBuilder } from '../builder';
import { houseKit, M, sidesOf, windowAt, type Frame } from './parts';

const PLINTH = 0.3 * M;
const LIGHT_WORK = 0xffe2b0;

const COLOR = {
  brick: [0x9c4e3b, 0xa65d40, 0x8c5a44] as const,
  stone: 0xcfc6b4,
  plinth: 0x6f6862,
  frame: 0x5d636b,
  glass: 0x46596a,
  roof: 0x4a4744,
  metal: 0x57524d,
  gate: 0x8c9399,
  rib: 0x7d858c,
  door: 0x4a3426,
  dock: 0x8d8a82,
  danger: 0xd8a23a,
};

/** Ворота-роллета w x h на фасаде: полотно с горизонтальными рёбрами, короб над ним. */
function rollGate(front: ReturnType<ReturnType<typeof houseKit>['part']>, t: number, w: number, h: number) {
  front(t, PLINTH, 0, w + 0.03, h + 0.02, 0.012, COLOR.frame);
  front(t, PLINTH, 0.007, w, h, 0.01, COLOR.gate);
  for (let y = 0.03; y < h; y += 0.03) front(t, PLINTH + y, 0.012, w, 0.006, 0.006, COLOR.rib);
  front(t, PLINTH + h + 0.01, 0.015, w + 0.04, 0.035, 0.03, COLOR.metal);
}

/** Кирпичная мастерская w x d: ворота-роллета, дверь, окна в переплётах, вывеска, вытяжная труба. */
export function brickWorkshop(g: GeoBuilder, o: Frame, v: number, u0: number, f0: number, y0: number, w: number, d: number) {
  const { box, part: on, light } = houseKit(g, o, u0, f0, y0);
  const sides = sidesOf(w, d);
  const front = on(sides[0]);
  const H = 0.36;
  const brick = COLOR.brick[v % COLOR.brick.length];
  const top = PLINTH + H;

  box(0, 0, 0, w + 0.01, PLINTH, d + 0.01, COLOR.plinth);
  box(0, PLINTH, 0, w, H, d, brick, COLOR.roof);
  box(0, top - 0.02, 0, w + 0.03, 0.03, d + 0.03, COLOR.stone, COLOR.roof);
  for (const s of [-1, 1]) {
    box(0, top + 0.01, s * (d / 2), w + 0.03, 0.035, 0.025, brick, COLOR.stone);
    box(s * (w / 2), top + 0.01, 0, 0.025, 0.035, d, brick, COLOR.stone);
  }
  // Ворота у одного края, дверь у другого, между ними окно; вывеска над воротами
  const gateT = (v % 2 ? 1 : -1) * (w / 2 - 0.2);
  rollGate(front, gateT, 0.3, 0.26);
  light(sides[0], 'worklight', gateT, PLINTH + 0.28, 0.08, 0.04, v * 5.1, LIGHT_WORK, 1);
  front(-gateT * 0.85, PLINTH, 0, 0.1, 0.22, 0.014, COLOR.door);
  front(0, PLINTH + 0.3, 0, Math.min(0.36, w * 0.5), 0.045, 0.02, COLOR.danger);
  const paint = { frame: COLOR.frame, glass: COLOR.glass, stone: COLOR.stone };
  windowAt(front, -gateT * 0.35, PLINTH + 0.11, 0.14, 0.15, paint);
  front(-gateT * 0.35, PLINTH + 0.11, 0.008, 0.14, 0.008, 0.012, COLOR.frame);
  // Окна по бокам и сзади, огонь в них ночью
  for (const si of [1, 2, 3]) {
    const s = sides[si];
    const n = Math.max(1, Math.floor(s.len / 0.3));
    for (let i = 0; i < n; i++) {
      const t = -s.len / 2 + (s.len / n) * (i + 0.5);
      windowAt(on(s), t, PLINTH + 0.13, 0.14, 0.14, paint);
      light(s, 'window', t, PLINTH + 0.13, 0.14, 0.14, v * 3.3 + si * 7 + i, LIGHT_WORK, 1);
    }
  }
  // Вытяжная труба и короб вентиляции на крыше
  const [px, pz] = o.at(u0 + w * 0.3, f0 - d * 0.2);
  g.cylinder(new THREE.Matrix4().makeTranslation(px, y0 + top, pz), 0.025, 0.2, COLOR.metal, 8);
  box(-w * 0.2, top, -d * 0.1, 0.12, 0.05, 0.1, 0x9a958c);
}

/** Склад w x d из профнастила: рёбра по стенам, двое ворот у погрузочной рампы, фонари над воротами. */
export function warehouse(g: GeoBuilder, o: Frame, v: number, u0: number, f0: number, y0: number, w: number, d: number, wall: number) {
  const { box, part: on, light } = houseKit(g, o, u0, f0, y0);
  const sides = sidesOf(w, d);
  const front = on(sides[0]);
  const H = 0.38;
  const top = PLINTH + H;

  box(0, 0, 0, w + 0.01, PLINTH, d + 0.01, COLOR.plinth);
  box(0, PLINTH, 0, w, H, d, wall, COLOR.roof);
  // Пологая крыша ступенькой к коньку вдоль фасада и поясок под ней
  box(0, top, 0, w + 0.04, 0.02, d + 0.04, COLOR.roof);
  box(0, top + 0.02, 0, w + 0.02, 0.02, d * 0.6, COLOR.roof);
  box(0, top + 0.04, 0, w, 0.015, d * 0.2, COLOR.roof);
  // Рёбра профнастила по всем стенам
  sides.forEach((s) => {
    const part = on(s);
    for (let t = -s.len / 2 + 0.03; t < s.len / 2; t += 0.05) part(t, PLINTH, 0.004, 0.01, H, 0.008, COLOR.rib);
  });
  // Рампа во всю ширину ворот, двое ворот, отбойники и фонари
  front(0, 0, 0.07, w * 0.8, PLINTH + 0.05, 0.14, COLOR.dock);
  for (const e of [-1, 1]) {
    const t = e * w * 0.22;
    rollGate(front, t, 0.24, 0.25);
    for (const b of [-1, 1]) front(t + b * 0.13, PLINTH + 0.02, 0.145, 0.02, 0.03, 0.02, 0x2b2622);
    front(t, PLINTH + 0.31, 0.03, 0.04, 0.02, 0.05, COLOR.metal);
    light(sides[0], 'worklight', t, PLINTH + 0.3, 0.08, 0.04, v * 4.7 + e, LIGHT_WORK, 1);
  }
  // Номер склада на фасаде
  front(0, PLINTH + 0.3, 0.004, 0.1, 0.06, 0.006, COLOR.danger);
  // Дверь сбоку
  on(sides[2])(0, PLINTH, 0.004, 0.1, 0.22, 0.014, COLOR.door);
}

/**
 * Цех w x d: кирпичные стены с высокими окнами, пилообразная крыша (скаты и стеклянные полосы
 * к северу), кирпичная труба с поясами. chimney - высота трубы (0 - без неё).
 */
export function factoryHall(g: GeoBuilder, o: Frame, v: number, u0: number, f0: number, y0: number, w: number, d: number, chimney: number) {
  const { box, part: on, light } = houseKit(g, o, u0, f0, y0);
  const sides = sidesOf(w, d);
  const H = 0.42;
  const brick = COLOR.brick[(v + 1) % COLOR.brick.length];
  const top = PLINTH + H;

  box(0, 0, 0, w + 0.01, PLINTH, d + 0.01, COLOR.plinth);
  box(0, PLINTH, 0, w, H, d, brick, COLOR.roof);
  box(0, top - 0.02, 0, w + 0.03, 0.03, d + 0.03, COLOR.stone, COLOR.roof);
  // Высокие окна-проёмы: стекло в частом переплёте
  const paint = { frame: COLOR.frame, glass: COLOR.glass, stone: COLOR.stone };
  sides.forEach((s, si) => {
    const part = on(s);
    const n = Math.max(1, Math.floor(s.len / 0.22));
    for (let i = 0; i < n; i++) {
      const t = -s.len / 2 + (s.len / n) * (i + 0.5);
      // Ворота в середине фасада вместо окна
      if (si === 0 && Math.abs(t) < s.len / n * 0.6) continue;
      windowAt(part, t, PLINTH + 0.1, 0.12, 0.24, paint);
      for (const y of [0.08, 0.16]) part(t, PLINTH + 0.1 + y, 0.008, 0.11, 0.008, 0.012, COLOR.frame);
      light(s, 'worklight', t, PLINTH + 0.1, 0.12, 0.24, v * 6.1 + si * 11 + i, LIGHT_WORK, 2);
    }
  });
  rollGate(on(sides[0]), 0, 0.3, 0.3);
  // Пилообразная крыша: зубцы поперёк фасада, у каждого скат и вертикальная стеклянная полоса
  const teeth = Math.max(2, Math.round(d / 0.22));
  const step = d / teeth, rise = 0.11;
  const slope = Math.hypot(step, rise), angle = Math.atan2(rise, step);
  for (let i = 0; i < teeth; i++) {
    const f = -d / 2 + step * i;
    const [x, z] = o.at(u0, f0 + f);
    // Скат: от низа у f до верха у f + step
    const m = new THREE.Matrix4().makeTranslation(x, y0 + top, z)
      .multiply(new THREE.Matrix4().makeRotationY(-o.rot))
      .multiply(new THREE.Matrix4().makeRotationX(Math.PI / 2 - angle));
    g.boxM(m, w, slope, 0.012, COLOR.roof);
    box(0, top, f + step - 0.004, w - 0.02, rise, 0.008, COLOR.glass);
  }
  // Торцы зубцов - треугольники кирпичом не делаем: закрываем низким парапетом по бокам
  for (const s of [-1, 1]) box(s * (w / 2), top, 0, 0.02, rise, d, brick);
  if (chimney > 0) {
    const [cx, cz] = o.at(u0 + w / 2 + 0.09, f0 - d * 0.25);
    const base = new THREE.Matrix4().makeTranslation(cx, y0, cz);
    g.cylinder(base, 0.07, chimney, brick, 10, COLOR.roof, 0.05);
    for (const k of [0.35, 0.7, 0.92]) {
      const r = 0.07 - 0.02 * k + 0.006;
      g.cylinder(new THREE.Matrix4().makeTranslation(cx, y0 + chimney * k, cz), r, 0.02, COLOR.stone, 10);
    }
    box(w / 2 + 0.09, 0, -d * 0.25, 0.2, 0.06, 0.2, COLOR.plinth);
  }
}
