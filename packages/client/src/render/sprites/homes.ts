// Дома и магазины участков (прототип 009): каждый дом собирается из случайного набора
// отличительных черт - форма (пристройка, эркер, гараж), крыша (мансарды, трубы, солнечные
// панели, антенна), стены (штукатурка, кирпич, сайдинг), окна (ставни, ящики с цветами,
// переплёты), вход (крыльцо, навес, фонарь), двор (забор, клумбы, сарай, качели, бельё...).
// Вариант - номер клетки 0..255, поэтому соседние дома почти никогда не повторяются.
// Координаты участка: x - вдоль улицы, z - к улице (фасад на +z).

import { rng } from './painter';
import { M } from './art';
import { AWNINGS, CARS, draw, H_FLOOR, Kit, pick, ROOFS, WALLS } from './buildings';
import type { Painted } from './painter';

const BRICKS = [0xb5664a, 0xa05a42, 0xc47a5a];
const TRIMS = [0xf2ece0, 0xe8dcc8, 0xf6f0e2, 0x8a6a4a];
const DOORS = [0x8a4a2a, 0x3f6f9a, 0x5f8a4a, 0xb0403a, 0x4a3a30, 0xe0b040];
const SHUTTERS = [0x4f7a5a, 0x3f5f8a, 0x8a4a3a, 0xe8e2d4, 0x6a5a4a, 0x2f6a7a];
const FLOWERS = [0xd8452f, 0xe8c547, 0xf2efe0, 0xd884b0, 0x9a6ad0, 0xe8803a];
const SIGNS = [0xd8452f, 0x3f7fc0, 0x5f9a52, 0xe0a030, 0x8a4aa0, 0x2f2f3a];

type Rnd = () => number;
const chance = (R: Rnd, p: number) => R() < p;
const choose = <T>(R: Rnd, list: readonly T[]) => list[Math.floor(R() * list.length)];

interface HouseSpec {
  x: number;
  z: number;
  w: number;
  d: number;
  floors: number;
  wall: number;
  skin: 'plaster' | 'brick' | 'siding';
  roof: number;
  roofKind: 'gable' | 'hip' | 'flat';
  trim: number;
}

/** Окно с чертами дома: рама, переплёт, ставни, ящик с цветами. */
function window1(k: Kit, R: Rnd, x: number, y: number, z: number, nx: number, nz: number, st: { shutters: number; box: boolean; cross: boolean; tall: boolean; trim: number }) {
  const b = k.b, ww = 0.075, wh = st.tall ? 0.13 : 0.1;
  const along = (o: number, a = 0) => [x + (nz ? o : 0) + nx * a, z + (nx ? o : 0) + nz * a] as const;
  const thin = (w: number, h: number, y0: number, o = 0, a = 0.004, depth = 0.012, mat = M.frame) => {
    const [px, pz] = along(o, a);
    b.box(px, y0, pz, nz ? w : depth, h, nx ? w : depth, mat);
  };
  const trim = k.tone(st.trim, 'along', { mottle: 0.03 });
  thin(ww + 0.026, wh + 0.026, y - 0.013, 0, 0.004, 0.012, trim);
  thin(ww, wh, y, 0, 0.008, 0.012, M.glass);
  if (st.cross) {
    thin(0.008, wh, y, 0, 0.012, 0.006, trim);
    thin(ww, 0.008, y + wh / 2, 0, 0.012, 0.006, trim);
  }
  if (st.shutters >= 0) {
    const sh = k.tone(st.shutters, 'along', { rows: 90, mottle: 0.04 });
    for (const s of [-1, 1]) thin(0.03, wh + 0.01, y - 0.005, s * (ww / 2 + 0.03), 0.006, 0.01, sh);
  }
  if (st.box) {
    thin(ww + 0.03, 0.025, y - 0.035, 0, 0.012, 0.03, M.planks);
    for (let i = 0; i < 4; i++) {
      const [px, pz] = along(-0.03 + i * 0.02, 0.022);
      b.ellipsoid(px, y - 0.008, pz, 0.012, 0.012, 0.012, k.tone(choose(R, FLOWERS), 'dab'), { seg: 5 });
    }
  }
}

/** Корпус дома со всеми чертами; возвращает высоту карниза. */
function house(k: Kit, R: Rnd, h: HouseSpec): number {
  const b = k.b;
  const wallMat = h.skin === 'brick' ? k.tone(choose(R, BRICKS), 'along', { rows: 46, mottle: 0.14 })
    : h.skin === 'siding' ? k.tone(h.wall, 'along', { rows: 70, mottle: 0.05, jitter: 0.04 })
    : k.tone(h.wall, 'along', { mottle: 0.07, jitter: 0.04 });
  const trim = k.tone(h.trim, 'along', { mottle: 0.03 });
  const roofMat = k.tone(h.roof, 'along', { mottle: 0.1, rows: 28 + Math.floor(R() * 10) });
  const top = 0.035 + h.floors * H_FLOOR;
  b.box(h.x, 0, h.z, h.w + 0.03, 0.04, h.d + 0.03, k.tone(0x8a8278, 'dab'));
  b.box(h.x, 0.035, h.z, h.w, top - 0.035, h.d, wallMat);
  // Угловые доски и пояс между этажами
  for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) b.box(h.x + (sx * h.w) / 2, 0.035, h.z + (sz * h.d) / 2, 0.022, top - 0.035, 0.022, trim);
  for (let f = 1; f < h.floors; f++) b.box(h.x, 0.035 + f * H_FLOOR - 0.01, h.z, h.w + 0.008, 0.016, h.d + 0.008, trim);
  // Окна: у дома свой стиль, на этаже - шаг по стене
  const st = {
    shutters: chance(R, 0.45) ? choose(R, SHUTTERS) : -1,
    box: chance(R, 0.4),
    cross: chance(R, 0.5),
    tall: chance(R, 0.4),
    trim: h.trim,
  };
  const door = (R() - 0.5) * h.w * 0.4;
  for (let f = 0; f < h.floors; f++) {
    const y = 0.035 + f * H_FLOOR + 0.075;
    for (const [nx, nz, len, off] of [[0, 1, h.w, h.d], [0, -1, h.w, h.d], [1, 0, h.d, h.w], [-1, 0, h.d, h.w]] as const) {
      const n = Math.max(1, Math.floor(len / (st.shutters >= 0 ? 0.24 : 0.2)));
      for (let i = 0; i < n; i++) {
        const t = ((i + 0.5) / n - 0.5) * len;
        if (f === 0 && nz === 1 && Math.abs(t - door) < 0.1) continue;
        const wx = nx ? h.x + (nx * off) / 2 : h.x + t, wz = nz ? h.z + (nz * off) / 2 : h.z + t;
        window1(k, R, wx, y, wz, nx, nz, st);
      }
    }
  }
  // Вход: дверь, фонарь, крыльцо (навес на кронштейнах или терраса на столбиках), ступени
  const front = h.z + h.d / 2;
  const dm = k.tone(choose(R, DOORS), 'vertical', { mottle: 0.05 });
  b.box(h.x + door, 0.035, front + 0.004, 0.095, 0.16, 0.012, trim);
  b.box(h.x + door, 0.035, front + 0.01, 0.075, 0.145, 0.012, dm);
  b.box(h.x + door + 0.06, 0.15, front + 0.012, 0.018, 0.025, 0.018, M.lamp);
  const porch = R();
  if (porch < 0.35) {
    b.box(h.x + door, 0, front + 0.06, 0.2, 0.035, 0.1, M.concrete);
    for (const s of [-1, 1]) b.box(h.x + door + s * 0.09, 0.035, front + 0.1, 0.014, 0.17, 0.014, trim);
    b.gable(h.x + door, 0.205, front + 0.055, 0.22, 0.12, 0.05, roofMat, trim, 'z', 0.015);
  } else if (porch < 0.65) {
    b.box(h.x + door, 0.17, front + 0.04, 0.16, 0.012, 0.08, roofMat);
    b.box(h.x + door, 0, front + 0.035, 0.12, 0.02, 0.06, M.concrete);
  } else {
    b.box(h.x + door, 0, front + 0.03, 0.12, 0.02, 0.05, M.concrete);
    b.box(h.x + door, 0, front + 0.06, 0.1, 0.01, 0.04, M.concrete);
  }
  // Балкон на втором этаже
  if (h.floors >= 2 && chance(R, 0.5)) {
    const bx = h.x + (R() - 0.5) * h.w * 0.3, by = 0.035 + H_FLOOR;
    b.box(bx, by, front + 0.05, 0.24, 0.016, 0.1, M.concrete);
    for (let i = 0; i <= 6; i++) b.box(bx - 0.11 + i * 0.037, by + 0.016, front + 0.095, 0.008, 0.06, 0.008, trim);
    b.box(bx, by + 0.07, front + 0.095, 0.24, 0.01, 0.01, trim);
    if (chance(R, 0.6)) for (const s of [-0.07, 0.07]) b.ellipsoid(bx + s, by + 0.04, front + 0.06, 0.025, 0.025, 0.025, M.leaf, { bump: 0.3, seed: R() * 9, seg: 6 });
  }
  // Водостоки, тарелка, кондиционер
  for (const s of [-1, 1]) b.cylinder(h.x + s * (h.w / 2 - 0.02), 0.035, front + 0.016, 0.008, top - 0.04, trim, 5);
  if (chance(R, 0.35)) b.ellipsoid(h.x + h.w / 2 + 0.012, top - 0.08, h.z, 0.01, 0.035, 0.035, M.frame, { seg: 8 });
  if (chance(R, 0.4)) b.box(h.x - h.w / 2 - 0.025, 0.1 + R() * 0.1, h.z - h.d * 0.2, 0.04, 0.05, 0.08, M.metal);
  // Крыша: свесы с белой доской, фронтоны с круглым окном, трубы, мансарды, панели, антенна
  const along = h.w >= h.d ? 'x' : 'z';
  const rh = Math.min(h.w, h.d) * (0.38 + R() * 0.12);
  if (h.roofKind === 'gable') {
    b.gable(h.x, top, h.z, h.w, h.d, rh, roofMat, wallMat, along, 0.055);
    const L = (along === 'x' ? h.w : h.d) + 0.11;
    for (const s of [-1, 1]) {
      if (along === 'x') b.box(h.x, top - 0.035, h.z + s * (h.d / 2 + 0.055), L, 0.03, 0.016, trim);
      else b.box(h.x + s * (h.w / 2 + 0.055), top - 0.035, h.z, 0.016, 0.03, L, trim);
      if (chance(R, 0.6)) {
        const gx = along === 'x' ? h.x + s * (h.w / 2 + 0.003) : h.x, gz = along === 'x' ? h.z : h.z + s * (h.d / 2 + 0.003);
        b.ellipsoid(gx, top + rh * 0.35, gz, along === 'x' ? 0.008 : 0.03, 0.03, along === 'x' ? 0.03 : 0.008, M.glass, { seg: 8 });
      }
    }
    if (along === 'x' && h.floors === 1 && chance(R, 0.45)) {
      // Мансардные окна на переднем скате
      const n = h.w > 0.5 ? 2 : 1;
      for (let i = 0; i < n; i++) {
        const dx = h.x + (n === 1 ? 0 : (i - 0.5) * h.w * 0.45), dz = h.z + h.d * 0.22, dy = top + rh * 0.42;
        b.box(dx, dy - 0.04, dz, 0.1, 0.09, 0.09, wallMat);
        b.box(dx, dy + 0.0, dz + 0.046, 0.06, 0.05, 0.006, M.glass);
        b.gable(dx, dy + 0.05, dz, 0.1, 0.1, 0.05, roofMat, wallMat, 'z', 0.015);
      }
    }
    if (along === 'x' && chance(R, 0.25)) {
      // Солнечные панели на заднем скате
      const ez = h.z - h.d / 2, ey = top - 0.01;
      for (let i = 0; i < 3; i++) {
        const px = h.x - 0.12 + i * 0.12, z0 = ez + 0.06, z1 = h.z - 0.04;
        const y0 = ey + (rh * (z0 - ez)) / (h.d / 2) + 0.008, y1 = ey + (rh * (z1 - ez)) / (h.d / 2) + 0.008;
        b.quad([px - 0.05, y0, z0], [px + 0.05, y0, z0], [px + 0.05, y1, z1], [px - 0.05, y1, z1], M.visor);
      }
    }
  } else if (h.roofKind === 'hip') {
    b.hip(h.x, top, h.z, h.w, h.d, rh * 0.9, roofMat, 0.055);
    b.box(h.x, top - 0.035, h.z, h.w + 0.11, 0.03, h.d + 0.11, trim);
  } else {
    b.box(h.x, top, h.z, h.w + 0.02, 0.04, h.d + 0.02, wallMat, { top: k.tone(0x9a958c, 'dab') });
    b.box(h.x + (R() - 0.5) * h.w * 0.4, top + 0.04, h.z - h.d * 0.2, 0.12, 0.07, 0.1, M.metal);
  }
  const chimneys = h.roofKind === 'flat' ? 0 : Math.floor(R() * 3);
  for (let i = 0; i < chimneys; i++) {
    const cx = h.x + (i ? -1 : 1) * h.w * (0.2 + R() * 0.12), cz = h.z - h.d * 0.12;
    b.box(cx, top, cz, 0.06, rh + 0.06, 0.06, M.brick);
    b.box(cx, top + rh + 0.06, cz, 0.075, 0.015, 0.075, M.concrete);
  }
  if (chance(R, 0.3)) {
    const ax = h.x - h.w * 0.25;
    b.box(ax, top + rh * 0.8, h.z, 0.008, 0.18, 0.008, M.metalDark);
    for (let i = 0; i < 3; i++) b.box(ax, top + rh * 0.8 + 0.08 + i * 0.03, h.z, 0.08 - i * 0.02, 0.006, 0.006, M.metalDark);
  }
  return top;
}

/** Забор участка одного из четырёх видов, с калиткой против двери. */
function fence(k: Kit, R: Rnd, x: number, z: number, w: number, d: number, gateX: number) {
  const kind = Math.floor(R() * 4);
  const b = k.b;
  if (kind === 2) {
    // Живая изгородь
    const run = (ax: number, az: number, bx: number, bz: number) => {
      const len = Math.hypot(bx - ax, bz - az), n = Math.max(1, Math.round(len / 0.07));
      for (let i = 0; i <= n; i++) b.ellipsoid(ax + ((bx - ax) * i) / n, 0.035, az + ((bz - az) * i) / n, 0.045, 0.045, 0.045, i % 3 ? M.leaf : M.leaf2, { bump: 0.3, seed: i, seg: 6, flatBottom: true });
    };
    const x0 = x - w / 2, x1 = x + w / 2, z0 = z - d / 2, z1 = z + d / 2;
    run(x0, z0, x1, z0); run(x0, z0, x0, z1); run(x1, z0, x1, z1);
    run(x0, z1, gateX - 0.1, z1); run(gateX + 0.1, z1, x1, z1);
    return;
  }
  if (kind === 3) {
    // Низкая каменная стенка с плиткой поверху
    const stone = k.tone(0xb8ab98, 'dab', { mottle: 0.25 }), cap = k.tone(0xd8d0c0, 'along');
    const seg = (cx: number, cz: number, lx: number, lz: number) => {
      b.box(cx, 0, cz, lx, 0.06, lz, stone);
      b.box(cx, 0.06, cz, lx + 0.01, 0.012, lz + 0.01, cap);
    };
    seg(x, z - d / 2, w, 0.03);
    seg(x - w / 2, z, 0.03, d);
    seg(x + w / 2, z, 0.03, d);
    const lw = gateX - 0.1 - (x - w / 2), rw = x + w / 2 - (gateX + 0.1);
    if (lw > 0.02) seg(x - w / 2 + lw / 2, z + d / 2, lw, 0.03);
    if (rw > 0.02) seg(gateX + 0.1 + rw / 2, z + d / 2, rw, 0.03);
    return;
  }
  k.fence(x, z, w, d, kind === 0 ? M.frame : M.planks, 0.2);
}

/** Мелочи двора: что-то одно из большого набора в точке (x, z). */
function yardThing(k: Kit, R: Rnd, x: number, z: number, v: number) {
  const b = k.b;
  switch (Math.floor(R() * 14)) {
    case 0: { // клумба
      b.box(x, 0, z, 0.2, 0.025, 0.12, M.earth);
      for (let i = 0; i < 7; i++) b.ellipsoid(x - 0.08 + R() * 0.16, 0.035, z - 0.04 + R() * 0.08, 0.014, 0.014, 0.014, k.tone(choose(R, FLOWERS), 'dab'), { seg: 5 });
      break;
    }
    case 1: { // сарай
      const wm = k.tone(choose(R, [0x9a7653, 0x8a9a7a, 0xb06a4a]), 'along', { rows: 80 });
      b.box(x, 0, z, 0.16, 0.12, 0.13, wm);
      b.gable(x, 0.12, z, 0.16, 0.13, 0.06, k.tone(choose(R, ROOFS), 'along', { rows: 40 }), wm, 'x', 0.015);
      b.box(x, 0, z + 0.066, 0.05, 0.09, 0.006, M.door);
      break;
    }
    case 2: { // теплица
      const gl = k.tone(0xd8eef0, 'vertical', { mottle: 0.04 });
      b.box(x, 0, z, 0.22, 0.09, 0.13, gl);
      b.gable(x, 0.09, z, 0.22, 0.13, 0.05, gl, gl, 'x', 0.005);
      for (let i = 0; i < 4; i++) b.box(x - 0.1 + i * 0.066, 0, z + 0.066, 0.006, 0.14, 0.006, M.frame);
      break;
    }
    case 3: { // будка с собакой
      b.box(x, 0, z, 0.08, 0.06, 0.08, M.planks);
      b.gable(x, 0.06, z, 0.08, 0.08, 0.035, k.tone(0xc4553b), M.planks, 'z', 0.01);
      b.ellipsoid(x + 0.07, 0.025, z + 0.03, 0.025, 0.022, 0.035, k.tone(choose(R, [0x8a5a3c, 0xe8dcc8, 0x3a3230])), { seg: 6 });
      break;
    }
    case 4: { // качели
      for (const s of [-1, 1]) {
        b.capsule([x + s * 0.1, 0, z - 0.04], [x + s * 0.1, 0.16, z], 0.007, M.metal, 4);
        b.capsule([x + s * 0.1, 0, z + 0.04], [x + s * 0.1, 0.16, z], 0.007, M.metal, 4);
      }
      b.box(x, 0.155, z, 0.22, 0.01, 0.01, M.metal);
      b.box(x, 0.05, z, 0.06, 0.01, 0.03, k.tone(0xd8452f));
      break;
    }
    case 5: { // верёвка с бельём
      for (const s of [-1, 1]) b.box(x + s * 0.12, 0, z, 0.008, 0.14, 0.008, M.planks);
      b.box(x, 0.135, z, 0.24, 0.004, 0.004, M.frame);
      for (let i = 0; i < 4; i++) b.box(x - 0.08 + i * 0.055, 0.09, z, 0.035, 0.045, 0.004, k.tone(choose(R, [...FLOWERS, 0x3f7fc0]), 'along'));
      break;
    }
    case 6: { // велосипед у стены
      for (const s of [-1, 1]) b.ellipsoid(x + s * 0.035, 0.025, z, 0.025, 0.025, 0.004, M.tyre, { seg: 8 });
      b.box(x, 0.04, z, 0.07, 0.008, 0.006, k.tone(choose(R, CARS)));
      break;
    }
    case 7: { // скамейка и бочка
      b.box(x, 0.035, z, 0.14, 0.012, 0.04, M.planks);
      for (const s of [-1, 1]) b.box(x + s * 0.06, 0, z, 0.01, 0.035, 0.035, M.metalDark);
      b.cylinder(x + 0.11, 0, z, 0.025, 0.06, k.tone(0x3f6f9a, 'vertical'), 8);
      break;
    }
    case 8: { // поленница
      for (let r = 0; r < 3; r++) for (let i = 0; i < 4 - r; i++) b.ellipsoid(x - 0.045 + i * 0.03 + r * 0.015, 0.012 + r * 0.022, z, 0.012, 0.012, 0.05, M.bark, { seg: 5 });
      break;
    }
    case 9: { // песочница
      b.box(x, 0, z, 0.16, 0.025, 0.16, M.planks);
      b.box(x, 0.004, z, 0.13, 0.024, 0.13, M.sand);
      b.ellipsoid(x + 0.03, 0.03, z, 0.02, 0.02, 0.02, k.tone(0xe0b030), { seg: 5 });
      break;
    }
    case 10: { // пруд с камнями
      b.ellipsoid(x, -0.02, z, 0.12, 0.03, 0.08, k.tone(0x5a96ad, 'dab', { mottle: 0.05 }), { seg: 10, flatBottom: true });
      for (let i = 0; i < 5; i++) { const a = i * 1.3; b.ellipsoid(x + Math.cos(a) * 0.12, 0.01, z + Math.sin(a) * 0.08, 0.02, 0.015, 0.02, M.stone, { seg: 5 }); }
      break;
    }
    case 11: { // мангал и столик с зонтом
      b.box(x, 0, z, 0.012, 0.12, 0.012, M.metal);
      b.ellipsoid(x, 0.12, z, 0.09, 0.025, 0.09, k.tone(choose(R, FLOWERS)), { seg: 10 });
      b.cylinder(x, 0.05, z, 0.05, 0.008, M.frame, 10);
      b.box(x + 0.1, 0, z + 0.03, 0.04, 0.06, 0.04, M.metalDark);
      break;
    }
    case 12: { // грядки
      for (let i = 0; i < 2; i++) {
        b.box(x, 0, z - 0.04 + i * 0.08, 0.2, 0.02, 0.05, M.earth);
        for (let j = 0; j < 4; j++) b.ellipsoid(x - 0.075 + j * 0.05, 0.03, z - 0.04 + i * 0.08, 0.018, 0.016, 0.018, j % 2 ? M.crop0 : M.crop2, { seg: 5 });
      }
      break;
    }
    default: k.tree(x, z, 0.55 + R() * 0.3, v * 7 + Math.floor(R() * 99), chance(R, 0.3));
  }
}

/** Жильё: коттедж, дом с двором или многоэтажка - каждый со своими чертами. */
export function paintHome(level: number, v: number, w: number, d: number, rel: number): Painted {
  return draw(rel, 11000 + v * 13 + level * 7, (k) => {
    const R = rng(v * 131 + level * 17 + w * 3 + d);
    const b = k.b, front = d / 2;
    const spec = (x: number, z: number, hw: number, hd: number, floors: number): HouseSpec => ({
      x, z, w: hw, d: hd, floors,
      wall: choose(R, WALLS), skin: choose(R, ['plaster', 'plaster', 'brick', 'siding'] as const),
      roof: choose(R, ROOFS), roofKind: chance(R, 0.3) ? 'hip' : 'gable', trim: choose(R, TRIMS),
    });
    if (level <= 2) {
      const floors = level === 1 ? 1 : chance(R, 0.75) ? 2 : 1;
      const hw = level === 1 ? 0.46 + R() * 0.16 : 0.58 + R() * 0.2, hd = level === 1 ? 0.4 + R() * 0.1 : 0.46 + R() * 0.14;
      const hz = front - 0.12 - hd / 2 - R() * 0.06, hx = (R() - 0.5) * (0.9 - hw) * 0.8;
      const h = spec(hx, hz, hw, hd, floors);
      house(k, R, h);
      // Пристройка: гараж сбоку, низкое крыло или веранда
      const side = hx > 0 ? -1 : 1, room = 0.45 - Math.abs(hx) - hw / 2;
      if (room > 0.14 && chance(R, 0.6)) {
        const aw = Math.min(room - 0.02, 0.22), ax = hx + side * (hw / 2 + aw / 2);
        if (chance(R, 0.5)) {
          const gm = k.tone(h.wall, 'along', { mottle: 0.06 });
          b.box(ax, 0, hz + 0.04, aw, 0.17, hd * 0.8, gm, { top: k.tone(0x8a857c, 'dab') });
          b.box(ax, 0.02, hz + 0.04 + hd * 0.4 + 0.004, aw * 0.8, 0.12, 0.01, k.tone(0xd8d2c4, 'along', { rows: 120 }));
          b.box(ax, 0.002, hz + hd * 0.4 + 0.2, aw * 0.8, 0.003, 0.3, M.concrete);
        } else {
          const wm = k.tone(h.wall, 'along', { mottle: 0.06 });
          b.box(ax, 0.035, hz - 0.02, aw, 0.18, hd * 0.6, wm);
          b.gable(ax, 0.215, hz - 0.02, aw, hd * 0.6, 0.08, k.tone(h.roof, 'along', { rows: 30 }), wm, 'z', 0.03);
          window1(k, R, ax, 0.11, hz - 0.02 + hd * 0.3, 0, 1, { shutters: -1, box: false, cross: true, tall: false, trim: h.trim });
        }
      }
      // Двор: дорожка из плит к калитке, забор, клумбы и мелочи, деревья
      const doorX = hx;
      for (let i = 0; i < 4; i++) b.box(doorX + (R() - 0.5) * 0.02, 0, front - 0.03 - i * ((front - hz - hd / 2) / 4), 0.07, 0.008, 0.05, M.concreteLight);
      fence(k, R, 0, 0, w - 0.08, d - 0.08, doorX);
      if (chance(R, 0.5)) b.box(doorX + 0.12, 0, front - 0.06, 0.03, 0.08, 0.03, k.tone(choose(R, SIGNS)));
      const slots: [number, number][] = level === 1
        ? [[-0.32, front - 0.12], [0.32, front - 0.12], [-0.33, -0.33], [0.33, -0.33]]
        : [[-0.28, -0.75], [0.28, -0.75], [-0.28, -0.3], [0.28, -0.3], [0, -0.52], [-0.33, front - 0.12], [0.33, front - 0.12]];
      const n = level === 1 ? 2 + Math.floor(R() * 2) : 3 + Math.floor(R() * 3);
      for (let i = 0; i < n; i++) {
        const j = Math.floor(R() * slots.length), [sx, sz] = slots.splice(j, 1)[0];
        if (Math.abs(sx - hx) < hw / 2 + 0.08 && Math.abs(sz - hz) < hd / 2 + 0.08) continue;
        yardThing(k, R, sx, sz, v);
      }
      for (let i = 0; i < 2; i++) k.bush((R() - 0.5) * 0.8, hz + hd / 2 + 0.06, 0.7 + R() * 0.4, v + i);
      if (chance(R, 0.35)) k.car(hx + 0.28 * (hx > 0 ? -1 : 1), front - 0.15, 'z', choose(R, CARS));
      return;
    }
    // Многоэтажка: балконы рядами, козырёк подъезда, хозяйство на крыше, двор с парковкой
    const floors = 3 + Math.floor(R() * 3), bw = w - 0.3, bd = 0.62 + R() * 0.14, bz = front - 0.1 - bd / 2;
    const h = spec(0, bz, bw, bd, floors);
    h.roofKind = chance(R, 0.7) ? 'flat' : 'hip';
    if (h.skin === 'siding') h.skin = 'plaster';
    const top = house(k, R, h);
    const balc = chance(R, 0.7), rail = k.tone(choose(R, TRIMS), 'along');
    if (balc) for (let f = 1; f < floors; f++) for (let i = 0; i < 4; i++) {
      const x = -bw * 0.375 + i * bw * 0.25 + 0.06;
      b.box(x, 0.035 + f * H_FLOOR, bz + bd / 2 + 0.04, 0.16, 0.014, 0.08, M.concrete);
      b.box(x, 0.05 + f * H_FLOOR, bz + bd / 2 + 0.078, 0.16, 0.05, 0.006, rail);
      if (chance(R, 0.3)) b.ellipsoid(x - 0.05, 0.07 + f * H_FLOOR, bz + bd / 2 + 0.05, 0.02, 0.02, 0.02, M.leaf, { seg: 5 });
      if (chance(R, 0.2)) b.box(x + 0.03, 0.08 + f * H_FLOOR, bz + bd / 2 + 0.07, 0.06, 0.04, 0.004, k.tone(choose(R, FLOWERS)));
    }
    if (h.roofKind === 'flat') {
      k.tank(bw * 0.3, bz - 0.1, 0.07, 0.12, 0xc9c2b4, top + 0.04);
      for (let i = 0; i < 3; i++) b.box(-bw * 0.3 + i * 0.12, top + 0.04, bz + 0.1, 0.08, 0.05, 0.07, M.metal);
      b.box(-bw * 0.1, top + 0.04, bz - 0.15, 0.006, 0.2, 0.006, M.metalDark);
    }
    for (let i = 0; i < 3; i++) k.car(-0.6 + i * 0.4, -0.62, 'z', choose(R, CARS));
    for (const x of [-0.85, 0.85]) k.tree(x, -0.65 + R() * 0.2, 0.8 + R() * 0.3, v + x * 10, chance(R, 0.3));
    for (let i = 0; i < 2; i++) yardThing(k, R, -0.3 + i * 0.6, -0.25, v);
    b.box(0.75, 0, front - 0.08, 0.06, 0.07, 0.05, M.military);
  }, { shadow: 0.46 });
}

/** Торговля: у каждого магазина свой профиль - кафе, овощи, аптека, булочная, хозтовары. */
export function paintShop(level: number, v: number, w: number, d: number, rel: number): Painted {
  return draw(rel, 12000 + v * 13 + level * 7, (k) => {
    const R = rng(v * 173 + level * 29 + w * 5 + d);
    const b = k.b, front = d / 2;
    const kind = Math.floor(R() * 5);
    const [aw0, aw1] = choose(R, AWNINGS);
    const wall = choose(R, WALLS), floors = level === 1 ? (chance(R, 0.4) ? 2 : 1) : level === 2 ? 2 : chance(R, 0.5) ? 2 : 4;
    const sw = level === 1 ? 0.74 + R() * 0.1 : level === 2 && (w < 2 || chance(R, 0.4)) ? w - 0.22 : level === 2 ? 0.76 : w - 0.2;
    const sd = level === 3 ? 0.82 : 0.56 + R() * 0.1;
    const sx = level === 2 && w >= 2 && sw < 1 ? (chance(R, 0.5) ? 0.5 : -0.5) : 0;
    const sz = level === 3 ? -0.4 : front - 0.16 - sd / 2;
    const h: HouseSpec = { x: sx, z: sz, w: sw, d: sd, floors, wall, skin: chance(R, 0.3) ? 'brick' : 'plaster', roof: choose(R, ROOFS), roofKind: chance(R, 0.25) && floors <= 2 ? 'gable' : 'flat', trim: choose(R, TRIMS) };
    const top = house(k, R, h);
    const fz = sz + sd / 2;
    // Витрина во всю ширину первого этажа, с товаром за стеклом
    b.box(sx, 0.05, fz + 0.012, sw - 0.16, 0.15, 0.012, M.glass);
    for (let i = 0; i < 5; i++) b.box(sx - sw * 0.35 + i * sw * 0.17, 0.055, fz + 0.02, 0.05, 0.04, 0.012, k.tone(choose(R, [...FLOWERS, ...SIGNS])));
    // Маркиза: полосатая, однотонная или секциями
    const style = Math.floor(R() * 3);
    if (style === 0) k.awning(sx - sw / 2 + 0.03, sx + sw / 2 - 0.03, fz + 0.01, 0.035 + H_FLOOR - 0.02, 0.15, aw0, aw1);
    else if (style === 1) k.awning(sx - sw / 2 + 0.03, sx + sw / 2 - 0.03, fz + 0.01, 0.035 + H_FLOOR - 0.02, 0.15, aw0, aw0);
    else for (let i = 0; i < 3; i++) { const x0 = sx - sw / 2 + 0.04 + (i * (sw - 0.08)) / 3; k.awning(x0, x0 + (sw - 0.08) / 3 - 0.02, fz + 0.01, 0.035 + H_FLOOR - 0.02, 0.13, i % 2 ? aw1 : aw0, aw0); }
    // Вывеска: на фасаде или на крыше, с буквами; неоновая лампа на углу
    const sc = choose(R, SIGNS);
    if (chance(R, 0.5) || h.roofKind !== 'flat') k.sign(sx, 0.035 + H_FLOOR + 0.03, fz + 0.016, sw * 0.6, sc);
    else {
      k.sign(sx, top + 0.06, fz - 0.03, sw * 0.7, sc);
      for (const s of [-1, 1]) b.box(sx + s * sw * 0.25, top + 0.035, fz - 0.03, 0.01, 0.03, 0.01, M.metalDark);
    }
    if (chance(R, 0.4)) b.box(sx + sw / 2 + 0.012, 0.25, fz - 0.04, 0.012, 0.08, 0.04, M.lamp);
    // Профиль магазина у входа
    const ox = sx - sw * 0.25, oz = fz + 0.24;
    if (kind === 0) {
      // Кафе: столики с зонтами
      for (const dx of [0, 0.26]) {
        b.cylinder(ox + dx, 0, oz, 0.035, 0.05, M.frame, 8);
        b.box(ox + dx, 0, oz, 0.008, 0.13, 0.008, M.metal);
        b.ellipsoid(ox + dx, 0.13, oz, 0.08, 0.025, 0.08, k.tone(aw0), { seg: 10 });
        for (const s of [-1, 1]) b.box(ox + dx + s * 0.05, 0, oz, 0.025, 0.035, 0.025, M.planks);
      }
    } else if (kind === 1) {
      // Овощи и фрукты в ящиках под маркизой
      for (let i = 0; i < 4; i++) {
        b.box(ox + i * 0.1, 0, fz + 0.07, 0.08, 0.04, 0.06, M.crate);
        for (let j = 0; j < 3; j++) b.ellipsoid(ox + i * 0.1 - 0.025 + j * 0.025, 0.05, fz + 0.07, 0.014, 0.012, 0.014, k.tone(choose(R, [0xd8452f, 0xe8a030, 0x8ab040, 0xe8d050])), { seg: 5 });
      }
    } else if (kind === 2) {
      // Аптека: зелёный крест на кронштейне
      const g = k.tone(0x3faa5a, 'along', { flat: true });
      b.box(sx + sw / 2 - 0.05, 0.3, fz + 0.05, 0.06, 0.02, 0.014, g);
      b.box(sx + sw / 2 - 0.05, 0.3, fz + 0.05, 0.02, 0.06, 0.014, g);
    } else if (kind === 3) {
      // Булочная: щит-раскладушка и кадки с цветами
      b.box(ox, 0, oz - 0.05, 0.05, 0.08, 0.02, M.planks);
      for (const dx of [-0.08, sw * 0.5]) { b.cylinder(ox + dx, 0, fz + 0.06, 0.03, 0.04, M.brick, 8); k.bush(ox + dx, fz + 0.06, 0.5, v); }
    } else {
      // Хозтовары: товар на поддонах и тележка
      for (let i = 0; i < 3; i++) b.box(ox + i * 0.09, 0, fz + 0.08, 0.07, 0.06 + R() * 0.04, 0.07, k.tone(choose(R, [0x9a7653, 0x3f7fc0, 0xd8d0c0, 0x5f9a52])));
      b.box(ox + 0.3, 0, fz + 0.12, 0.08, 0.04, 0.05, M.metal);
    }
    // Велопарковка, урна, горшки; машины покупателей
    b.box(sx + sw * 0.35, 0, fz + 0.2, 0.012, 0.06, 0.012, M.metalDark);
    b.cylinder(sx + sw * 0.42, 0, fz + 0.18, 0.02, 0.05, M.military, 6);
    if (level >= 2 || w >= 2) for (let i = 0; i < (level === 3 ? 4 : 2); i++) k.car(-0.6 + i * 0.36 + (level === 2 ? -sx * 0.9 : 0), level === 3 ? 0.55 : 0.1 + (i % 2) * -0.25, 'z', choose(R, CARS));
    else if (chance(R, 0.5)) k.car(-0.28, 0.42, 'x', choose(R, CARS));
    if (level === 3) for (const x of [-0.88, 0.88]) k.tree(x, 0.6, 0.75, v + x * 7, chance(R, 0.3));
  }, { shadow: 0.46 });
}
