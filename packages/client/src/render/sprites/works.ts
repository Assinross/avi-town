// Промзона и фермы по клеткам (прототип 009): как и дома, каждая клетка собирается из своего
// набора черт. Промзона - мастерские, склады с рампами, цеха с пилообразной крышей, заводы с
// баками, трубами и эстакадами; во дворе - поддоны, ящики, бочки, контейнеры, погрузчик, грузовик.
// Фермы - поля разных культур (пшеница, кукуруза, капуста, тыквы, подсолнухи), пугало, стога,
// трактор, курятник, амбар с ломаной крышей, силос, коровы и овцы.
// Координаты клетки: x вдоль улицы, z к улице (фасад на +z), клетка от -0.5 до 0.5.

import { rng } from './painter';
import { M } from './art';
import { CARS, draw, Kit } from './buildings';
import type { Painted } from './painter';

type Rnd = () => number;
const chance = (R: Rnd, p: number) => R() < p;
const choose = <T>(R: Rnd, list: readonly T[]) => list[Math.floor(R() * list.length)];

const IWALLS = [0xc9bba4, 0xa8b0b5, 0xb07a62, 0xd2ccc0, 0x9aa88a, 0xc4a070, 0x8a9aa8, 0xd8c8a8];
const IROOFS = [0x8a8f94, 0x5f7f9a, 0xa0522d, 0x6f8a5a, 0xb08a4a, 0x4f6f8a, 0xc4553b];
const CONTAINERS = [0xc4553b, 0x3f6fa0, 0x5f8a5a, 0xd89a3a, 0x7a7f88];

/** Двор промзоны: поддоны, ящики, бочки, контейнер, погрузчик, грузовик - по нескольку. */
function yardStuff(k: Kit, R: Rnd, spots: [number, number][]) {
  const b = k.b;
  for (const [x, z] of spots) {
    switch (Math.floor(R() * 7)) {
      case 0: // поддоны с мешками
        b.box(x, 0, z, 0.12, 0.015, 0.1, M.planks);
        for (let i = 0; i < 3; i++) b.ellipsoid(x - 0.035 + i * 0.035, 0.03, z, 0.02, 0.016, 0.04, M.sack, { seg: 5 });
        break;
      case 1: // ящики штабелем
        b.box(x, 0, z, 0.08, 0.07, 0.08, M.crate);
        b.box(x + 0.02, 0.07, z - 0.01, 0.06, 0.05, 0.06, M.crate);
        break;
      case 2: // бочки
        for (let i = 0; i < 3; i++) b.cylinder(x - 0.03 + (i % 2) * 0.05, 0, z + (i > 1 ? 0.05 : 0), 0.022, 0.06, choose(R, [M.rust, M.military, M.metal]), 8);
        break;
      case 3: { // контейнер
        const c = k.tone(choose(R, CONTAINERS), 'along', { rows: 140, mottle: 0.08 });
        b.box(x, 0, z, 0.26, 0.11, 0.11, c);
        break;
      }
      case 4: // погрузчик
        b.box(x, 0.01, z, 0.06, 0.04, 0.08, M.hazard);
        b.box(x, 0.05, z - 0.01, 0.05, 0.04, 0.04, M.visor);
        b.box(x, 0.01, z + 0.05, 0.05, 0.08, 0.008, M.metalDark);
        break;
      case 5: // катушка кабеля и трубы
        b.ellipsoid(x, 0.04, z, 0.012, 0.04, 0.04, M.planks, { seg: 8 });
        for (let i = 0; i < 3; i++) b.capsule([x - 0.08, 0.012 + i * 0.02, z + 0.06], [x + 0.08, 0.012 + i * 0.02, z + 0.06], 0.01, M.metal, 5);
        break;
      default: // грузовик у рампы
        b.box(x, 0.02, z - 0.04, 0.1, 0.1, 0.16, k.tone(0xe6dac2, 'along', { mottle: 0.06 }));
        b.box(x, 0.02, z + 0.08, 0.09, 0.07, 0.07, k.tone(choose(R, CARS)));
        b.box(x, 0.06, z + 0.116, 0.08, 0.025, 0.004, M.visor);
    }
  }
}

/** Промзона: мастерская, склад или завод со своим набором черт. */
export function paintWorks(level: number, v: number, rel: number): Painted {
  return draw(rel, 13000 + v * 11 + level * 5, (k) => {
    const R = rng(v * 97 + level * 13);
    const b = k.b;
    const wall = k.tone(choose(R, IWALLS), 'along', { rows: chance(R, 0.6) ? 34 + Math.floor(R() * 20) : 0, mottle: 0.1, streaks: 0.12 });
    const roofC = choose(R, IROOFS), roof = k.tone(roofC, 'along', { rows: 46 });
    // Бетонная площадка и разметка двора
    b.box(0, 0, 0, 0.94, 0.012, 0.94, M.concrete);
    for (let i = 0; i < 3; i++) b.box(-0.3 + i * 0.3, 0.012, 0.4, 0.012, 0.002, 0.12, M.hazard);
    if (level === 1) {
      const form = Math.floor(R() * 4);
      if (form === 1) {
        // Гаражный бокс: плоская крыша, два ряда рольставен, бочки у стены
        b.box(0, 0, -0.1, 0.78, 0.2, 0.46, wall, { top: k.tone(0x8a857c, 'dab') });
        for (let i = 0; i < 4; i++) b.box(-0.29 + i * 0.193, 0, 0.13 + 0.004, 0.15, 0.15, 0.012, k.tone(choose(R, [0xb8b4ac, 0x6f8a9a, 0xc4553b, 0x5f8a5a]), 'along', { rows: 140 }));
        b.box(0, 0.2, 0.15, 0.8, 0.02, 0.05, roof);
        yardStuff(k, R, [[-0.3, 0.34], [0.05, 0.36], [0.33, 0.33]]);
        return;
      }
      if (form === 2) {
        // Контейнерный двор: штабели контейнеров, вагончик-контора, прожектор
        for (let i = 0; i < 3; i++) for (let j = 0; j < 1 + Math.floor(R() * 2); j++) {
          const c = k.tone(choose(R, CONTAINERS), 'along', { rows: 140, mottle: 0.08 });
          b.box(-0.15 + j * 0.02, j * 0.11, -0.3 + i * 0.13, 0.5, 0.11, 0.12, c);
        }
        b.box(0.28, 0, 0.18, 0.24, 0.13, 0.15, k.tone(0xe8e2d4, 'along', { rows: 90 }));
        b.box(0.28, 0.05, 0.257, 0.1, 0.05, 0.004, M.glass);
        b.box(0.4, 0, -0.35, 0.012, 0.35, 0.012, M.metalDark);
        b.box(0.4, 0.35, -0.35, 0.05, 0.03, 0.04, M.lamp);
        yardStuff(k, R, [[-0.3, 0.33]]);
        return;
      }
      if (form === 3) {
        // Лесопилка: навес на столбах, штабели брёвен и досок, опилки
        for (const [x, z] of [[-0.35, -0.35], [0.35, -0.35], [0.35, 0.05], [-0.35, 0.05]]) b.box(x, 0, z, 0.025, 0.22, 0.025, M.bark);
        b.gable(0, 0.22, -0.15, 0.76, 0.46, 0.08, roof, M.planks, 'x', 0.03);
        b.box(0, 0, -0.15, 0.3, 0.06, 0.1, M.metal);
        for (let r = 0; r < 3; r++) for (let i = 0; i < 5 - r; i++) b.capsule([-0.38, 0.02 + r * 0.035, 0.22 + i * 0.035 + r * 0.017], [0.0, 0.02 + r * 0.035, 0.22 + i * 0.035 + r * 0.017], 0.017, M.bark, 5);
        for (let i = 0; i < 4; i++) b.box(0.25, i * 0.02, 0.3, 0.3, 0.018, 0.14, M.planks);
        b.ellipsoid(0.1, 0, -0.3, 0.08, 0.03, 0.06, M.sand, { seg: 7, flatBottom: true });
        return;
      }
      // Мастерская: двускатная крыша из профнастила, ворота-рольставня, вывеска, верстак у ворот
      const w = 0.6 + R() * 0.14, d = 0.5 + R() * 0.1, h = 0.26 + R() * 0.06, z = -0.12;
      b.box(0, 0, z, w, h, d, wall);
      b.gable(0, h, z, w, d, 0.1 + R() * 0.05, roof, wall, 'x', 0.04);
      const dx = (R() - 0.5) * 0.2;
      b.box(dx, 0, z + d / 2 + 0.004, 0.26, 0.2, 0.012, k.tone(0xb8b4ac, 'along', { rows: 120 }));
      b.box(dx, 0.2, z + d / 2 + 0.01, 0.3, 0.02, 0.02, M.hazard);
      b.box(dx + 0.2, 0, z + d / 2 + 0.004, 0.06, 0.13, 0.012, M.door);
      k.sign(-dx * 0.5, h - 0.06, z + d / 2 + 0.016, 0.24, choose(R, IROOFS));
      if (chance(R, 0.5)) b.box(w / 2 - 0.08, h, z, 0.1, 0.08, 0.08, M.metal);
      if (chance(R, 0.5)) k.stack(-w / 2 + 0.08, z - 0.12, 0.25, 0.025, h);
      yardStuff(k, R, [[-0.32, 0.32], [0.3, 0.3]]);
      return;
    }
    if (level === 2) {
      // Склад или цех: пилообразная крыша с окнами или плоская с фонарями, рампа с воротами
      const w = 0.82, d = 0.62 + R() * 0.08, h = 0.36 + R() * 0.08, z = -0.1;
      b.box(0, 0, z, w, h, d, wall);
      if (chance(R, 0.5)) {
        for (let i = 0; i < 4; i++) {
          const x = -w / 2 + w / 8 + (i * w) / 4;
          b.quad([x - w / 8, h, z + d / 2], [x + w / 8, h, z + d / 2], [x + w / 8, h + 0.1, z - d / 2], [x - w / 8, h + 0.1, z - d / 2], roof);
          b.quad([x + w / 8, h, z + d / 2], [x + w / 8, h + 0.1, z - d / 2], [x + w / 8, h, z - d / 2], [x + w / 8, h, z + d / 2], M.glass);
        }
      } else {
        b.box(0, h, z, w + 0.02, 0.03, d + 0.02, wall, { top: k.tone(roofC, 'dab') });
        for (let i = 0; i < 3; i++) b.box(-0.25 + i * 0.25, h + 0.03, z, 0.14, 0.04, d * 0.6, M.glass, { inset: 0.02 });
      }
      // Погрузочная рампа и ворота
      b.box(0, 0, z + d / 2 + 0.06, w * 0.7, 0.06, 0.12, M.concrete);
      for (let i = 0; i < 3; i++) {
        const x = -0.22 + i * 0.22;
        b.box(x, 0.06, z + d / 2 + 0.004, 0.16, 0.18, 0.012, k.tone(choose(R, [0xb8b4ac, 0x6f8a9a, 0xd89a3a]), 'along', { rows: 120 }));
        b.box(x, 0.25, z + d / 2 + 0.02, 0.18, 0.012, 0.04, roof);
      }
      k.sign(0, h - 0.07, z + d / 2 + 0.016, 0.4, choose(R, CONTAINERS));
      for (const s of [-1, 1]) b.cylinder(s * (w / 2 - 0.02), 0, z + d / 2 + 0.015, 0.008, h, M.metalDark, 5);
      yardStuff(k, R, [[-0.36, 0.38], [0.36, 0.38]]);
      return;
    }
    // Завод: цех, баки, высокая труба, эстакада труб, лестница, прожектор
    const w = 0.56, d = 0.62, h = 0.4 + R() * 0.1, x0 = -0.17;
    b.box(x0, 0, -0.05, w, h, d, wall, { top: k.tone(roofC, 'dab') });
    for (let i = 0; i < 2; i++) b.box(x0 - 0.12 + i * 0.24, h, -0.05, 0.12, 0.05, 0.4, M.metal);
    b.box(x0, 0, -0.05 + d / 2 + 0.004, 0.24, 0.22, 0.012, M.metalDark);
    const tanks = 1 + Math.floor(R() * 3);
    for (let i = 0; i < tanks; i++) {
      const tz = -0.3 + i * 0.25, r = 0.08 + R() * 0.04;
      k.tank(0.32, tz, r, 0.22 + R() * 0.2, choose(R, [0xd9d4c8, 0x9aa8b0, 0xc4553b, 0xe8e2d4]));
      b.capsule([0.32, 0.12, tz], [x0 + w / 2, 0.3, tz], 0.012, M.metal, 5);
    }
    k.stack(x0 - 0.18, -0.28, 0.6 + R() * 0.3, 0.05, 0);
    for (let i = 0; i < 6; i++) b.box(x0 + w / 2 + 0.004, 0.04 + i * 0.06, 0.15, 0.006, 0.006, 0.06, M.metal);
    b.box(x0 + w / 2 + 0.004, 0.04, 0.12, 0.006, 0.36, 0.006, M.metal);
    b.box(x0 + w / 2 + 0.004, 0.04, 0.18, 0.006, 0.36, 0.006, M.metal);
    b.box(x0 - w / 2 + 0.05, h + 0.05, 0.2, 0.04, 0.03, 0.03, M.lamp);
    yardStuff(k, R, [[0.32, 0.38], [-0.38, 0.38]]);
  }, { shadow: 0.46 });
}

/** Поле одной культуры рядами по клетке. */
function field(k: Kit, R: Rnd, crop: number, z0: number, z1: number) {
  const b = k.b;
  const rows = 6;
  for (let i = 0; i < rows; i++) {
    const x = -0.4 + (i * 0.8) / (rows - 1);
    b.box(x, 0, (z0 + z1) / 2, 0.08, 0.018, z1 - z0, M.earth);
    const n = Math.max(2, Math.round((z1 - z0) / 0.09));
    for (let j = 0; j < n; j++) {
      const z = z0 + 0.04 + (j * (z1 - z0 - 0.08)) / Math.max(1, n - 1);
      switch (crop) {
        case 0: // пшеница: золотые пучки
          b.ellipsoid(x, 0.04, z, 0.035, 0.035, 0.04, M.crop1, { bump: 0.3, seed: i * 9 + j, seg: 6, flatBottom: true });
          break;
        case 1: // кукуруза: высокие стебли
          b.capsule([x, 0, z], [x, 0.12, z], 0.012, M.crop0, 4);
          b.ellipsoid(x, 0.11, z, 0.03, 0.025, 0.03, M.crop0, { bump: 0.3, seed: i + j, seg: 5 });
          break;
        case 2: // капуста
          b.ellipsoid(x, 0.025, z, 0.03, 0.025, 0.03, k.tone(0x9ac25a, 'dab'), { bump: 0.2, seed: j, seg: 6 });
          break;
        case 3: // тыквы в листве
          b.ellipsoid(x, 0.02, z, 0.035, 0.02, 0.035, M.leaf, { bump: 0.3, seed: j, seg: 5, flatBottom: true });
          if ((i + j) % 2) b.ellipsoid(x + 0.015, 0.025, z, 0.022, 0.018, 0.022, M.leafAutumn, { seg: 6 });
          break;
        default: // подсолнухи
          b.capsule([x, 0, z], [x, 0.11, z], 0.008, M.crop0, 4);
          b.ellipsoid(x, 0.12, z + 0.01, 0.025, 0.025, 0.008, k.tone(0xf0c030, 'dab'), { seg: 6 });
      }
    }
  }
}

/** Ферма: поле на всю клетку или поле с постройками и животными. */
export function paintFarm(level: number, v: number, rel: number): Painted {
  return draw(rel, 14000 + v * 7 + level * 3, (k) => {
    const R = rng(v * 61 + level * 23);
    const b = k.b;
    const crop = Math.floor(R() * 5);
    if (level === 1) {
      field(k, R, crop, -0.42, 0.42);
      if (chance(R, 0.35)) {
        // Пугало
        b.box(0.02, 0, 0.0, 0.01, 0.2, 0.01, M.planks);
        b.box(0.02, 0.15, 0.0, 0.12, 0.01, 0.01, M.planks);
        b.ellipsoid(0.02, 0.21, 0, 0.02, 0.022, 0.02, M.sack, { seg: 6 });
        b.box(0.02, 0.1, 0.005, 0.05, 0.06, 0.01, k.tone(0xb0503a));
      }
      return;
    }
    field(k, R, crop, -0.05, 0.42);
    const b2 = Math.floor(R() * 4);
    if (level === 2) {
      switch (b2) {
        case 0: { // сарай с инструментом
          const wm = k.tone(0x9a7653, 'along', { rows: 70 });
          b.box(-0.15, 0, -0.28, 0.42, 0.18, 0.26, wm);
          b.gable(-0.15, 0.18, -0.28, 0.42, 0.26, 0.09, k.tone(0x7d7f85, 'along', { rows: 40 }), wm, 'x', 0.03);
          b.box(-0.15, 0, -0.149, 0.12, 0.13, 0.006, M.door);
          break;
        }
        case 1: { // курятник с курами
          b.box(-0.2, 0, -0.3, 0.22, 0.12, 0.16, M.planks);
          b.gable(-0.2, 0.12, -0.3, 0.22, 0.16, 0.06, k.tone(0xc4553b, 'along', { rows: 40 }), M.planks, 'x', 0.02);
          for (let i = 0; i < 5; i++) b.ellipsoid(-0.05 + R() * 0.3, 0.015, -0.2 + R() * 0.12, 0.013, 0.013, 0.016, M.frame, { seg: 5 });
          break;
        }
        case 2: // стога сена
          for (let i = 0; i < 3; i++) b.ellipsoid(-0.28 + i * 0.22, 0.05, -0.28, 0.08, 0.07, 0.07, M.crop1, { bump: 0.25, seed: i, seg: 9, flatBottom: true });
          break;
        default: // трактор
          b.box(0, 0.03, -0.28, 0.09, 0.06, 0.16, k.tone(choose(R, [0xc4402a, 0x4f8a3a, 0x3f6fa0])));
          b.box(0, 0.09, -0.32, 0.08, 0.07, 0.07, M.visor);
          for (const s of [-1, 1]) {
            b.ellipsoid(s * 0.055, 0.045, -0.33, 0.015, 0.045, 0.045, M.tyre, { seg: 8 });
            b.ellipsoid(s * 0.05, 0.025, -0.2, 0.012, 0.025, 0.025, M.tyre, { seg: 7 });
          }
      }
      k.fence(0, -0.25, 0.9, 0.36, M.planks, 0.2);
      return;
    }
    // Двор с амбаром (ломаная крыша), силосом и животными
    const barn = k.tone(choose(R, [0xb0402e, 0xa8503a, 0x8a5a3c]), 'along', { rows: 70, mottle: 0.1 });
    const rf = k.tone(choose(R, [0x6f5a4a, 0x7d7f85, 0x4f5a4a]), 'along', { rows: 36 });
    const bx = -0.16, bz = -0.26, w = 0.4, d = 0.32, h = 0.2;
    b.box(bx, 0, bz, w, h, d, barn);
    // Ломаная (амбарная) крыша: крутой нижний скат и пологий верхний
    for (const s of [-1, 1]) {
      b.quad([bx - w / 2 - 0.02, h, bz + s * (d / 2 + 0.02)], [bx + w / 2 + 0.02, h, bz + s * (d / 2 + 0.02)], [bx + w / 2 + 0.02, h + 0.09, bz + s * d * 0.25], [bx - w / 2 - 0.02, h + 0.09, bz + s * d * 0.25], rf);
      b.quad([bx - w / 2 - 0.02, h + 0.09, bz + s * d * 0.25], [bx + w / 2 + 0.02, h + 0.09, bz + s * d * 0.25], [bx + w / 2 + 0.02, h + 0.13, bz], [bx - w / 2 - 0.02, h + 0.13, bz], rf);
    }
    for (const s of [-1, 1]) {
      const ex = bx + (s * w) / 2;
      b.quad([ex, h, bz + d / 2], [ex, h + 0.09, bz + d * 0.25], [ex, h + 0.09, bz - d * 0.25], [ex, h, bz - d / 2], barn);
      b.tri([ex, h + 0.09, bz + d * 0.25], [ex, h + 0.13, bz], [ex, h + 0.09, bz - d * 0.25], barn);
    }
    b.box(bx, 0, bz + d / 2 + 0.004, 0.14, 0.15, 0.008, M.frame);
    b.box(bx, 0.01, bz + d / 2 + 0.01, 0.11, 0.13, 0.008, k.tone(0x8a3a2a));
    b.box(bx, 0.01, bz + d / 2 + 0.014, 0.11, 0.008, 0.004, M.frame);
    k.tank(0.27, -0.3, 0.09, 0.42, choose(R, [0xc9c2b4, 0x9aa8b0, 0xd8d0c0]));
    b.ellipsoid(0.27, 0.42, -0.3, 0.09, 0.06, 0.09, M.metal, { seg: 9 });
    // Животные: коровы или овцы
    const cows = chance(R, 0.5);
    for (let i = 0; i < 2 + Math.floor(R() * 2); i++) {
      const x = -0.35 + R() * 0.7, z = -0.06 + R() * 0.08 - 0.02;
      if (cows) {
        b.ellipsoid(x, 0.05, z, 0.045, 0.028, 0.025, M.frame, { seg: 7 });
        b.ellipsoid(x + 0.01, 0.06, z, 0.02, 0.016, 0.02, M.tyre, { seg: 5 });
        b.box(x + 0.05, 0.05, z, 0.025, 0.022, 0.02, M.frame);
        for (const [lx, lz] of [[-0.025, -0.012], [0.025, -0.012], [-0.025, 0.012], [0.025, 0.012]]) b.box(x + lx, 0, z + lz, 0.008, 0.03, 0.008, M.tyre);
      } else {
        b.ellipsoid(x, 0.04, z, 0.035, 0.028, 0.025, M.frame, { bump: 0.25, seed: i, seg: 7 });
        b.ellipsoid(x + 0.035, 0.045, z, 0.012, 0.012, 0.012, M.tyre, { seg: 5 });
      }
    }
  }, { shadow: 0.44 });
}
