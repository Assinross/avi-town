// Рецепты исследовательских зданий (plan.md 010, этап 5): лаборатория растёт с ярусом -
// светлый корпус в два этажа с лентами окон и синим поясом (1), трёхэтажный корпус со стеклянным
// атриумом и куполом обсерватории (2), башня центра с корпусом и переходом (3). Радар - будка
// и решётчатая мачта с тарелкой. Детали - parts.ts, фасад - к +f.

import * as THREE from 'three';
import type { GeoBuilder } from '../builder';
import { hash, houseKit, sidesOf, type Frame } from './parts';
import { beacon } from './utilities';

const LIGHT_LAB = 0xa8e8ff;
const FLOOR = 0.34, PLINTH = 0.04;

const COLOR = {
  wall: 0xd9dde0,
  plinth: 0x6f6862,
  band: 0x2f6fb0,
  glass: 0x3d4b57,
  atrium: 0x6f93a8,
  frame: 0xeef0ec,
  roof: 0x5d7088,
  metal: 0x57524d,
  steel: 0x8c9399,
  dish: 0xe6e6e6,
  dome: 0xdfe3e6,
  slit: 0x2a2f36,
  concrete: 0xb8b2a6,
  hazard: 0xd8a23a,
  gas: [0x3f7d4f, 0x2f6fb0, 0xc8c2b6] as const,
};

type Kit = ReturnType<typeof houseKit>;

/** Корпус w x d в floors этажей: ленты окон на всех сторонах, синий пояс-карниз; возвращает высоту крыши. */
function labBlock(k: Kit, w: number, d: number, floors: number, seed: number, entry = 0) {
  const sides = sidesOf(w, d);
  const top = PLINTH + floors * FLOOR;
  k.box(0, 0, 0, w + 0.01, PLINTH, d + 0.01, COLOR.plinth);
  k.box(0, PLINTH, 0, w, floors * FLOOR, d, COLOR.wall, COLOR.roof);
  k.box(0, top - 0.04, 0, w + 0.04, 0.05, d + 0.04, COLOR.band, COLOR.roof);
  for (const s of [-1, 1]) {
    k.box(0, top + 0.01, s * (d / 2 + 0.01), w + 0.04, 0.04, 0.02, COLOR.wall);
    k.box(s * (w / 2 + 0.01), top + 0.01, 0, 0.02, 0.04, d, COLOR.wall);
  }
  sides.forEach((s, si) => {
    const part = k.part(s);
    for (let fl = 0; fl < floors; fl++) {
      const y = PLINTH + fl * FLOOR + 0.1;
      const runs: [number, number][] = si === 0 && fl === 0 && entry
        ? [[-s.len / 2 + 0.05, -entry / 2 - 0.03], [entry / 2 + 0.03, s.len / 2 - 0.05]]
        : [[-s.len / 2 + 0.05, s.len / 2 - 0.05]];
      for (const [a, b] of runs) {
        const len = b - a, c = (a + b) / 2;
        if (len < 0.08) continue;
        part(c, y - 0.01, 0, len + 0.02, 0.16, 0.012, COLOR.frame);
        part(c, y, 0.006, len, 0.14, 0.008, COLOR.glass);
        const n = Math.round(len / 0.11);
        for (let i = 1; i < n; i++) part(a + (len * i) / n, y, 0.008, 0.01, 0.14, 0.012, COLOR.frame);
        k.light(s, 'lab', c, y, len, 0.14, seed + si * 7.3 + fl * 2.9 + a, LIGHT_LAB, 2);
      }
    }
  });
  return top;
}

/** Купол радиуса r на высоте y: стопка усечённых конусов, тёмная щель телескопа. */
function dome(k: Kit, u: number, f: number, y: number, r: number) {
  k.cyl(u, f, y, r + 0.02, 0.05, COLOR.wall, 16);
  const n = 5;
  for (let i = 0; i < n; i++) {
    const a0 = (i / n) * (Math.PI / 2), a1 = ((i + 1) / n) * (Math.PI / 2);
    k.cyl(u, f, y + 0.05 + r * Math.sin(a0), r * Math.cos(a0), r * (Math.sin(a1) - Math.sin(a0)), COLOR.dome, 16, COLOR.dome, r * Math.cos(a1));
  }
  k.box(u, y + 0.05 + r * 0.3, f + r * 0.55, r * 0.3, r * 0.6, r * 0.45, COLOR.slit);
}

/** Крышное оборудование: вентиляционные блоки, антенна с синим наконечником. */
function roofKit(k: Kit, w: number, d: number, top: number, seed: number) {
  for (let i = 0; i < 2; i++) {
    const u = (hash(seed, i) - 0.5) * w * 0.5, f = -d * 0.22 + i * 0.12;
    k.box(u, top, f, 0.14, 0.07, 0.1, COLOR.steel, COLOR.metal);
  }
  k.box(w * 0.36, top, -d * 0.3, 0.025, 0.42, 0.025, COLOR.metal);
  k.box(w * 0.36, top + 0.42, -d * 0.3, 0.1, 0.03, 0.1, COLOR.band);
}

/** Стеклянный вход-тамбур с козырьком у фасада корпуса глубиной d. */
function entrance(k: Kit, d: number, w: number) {
  k.box(0, 0, d / 2 + 0.06, w, 0.28, 0.12, COLOR.atrium, COLOR.roof);
  k.box(0, 0.28, d / 2 + 0.09, w + 0.1, 0.025, 0.2, COLOR.band);
  for (const e of [-1, 1]) k.box(e * (w / 2 + 0.03), 0, d / 2 + 0.17, 0.02, 0.28, 0.02, COLOR.metal);
  k.box(0, 0, d / 2 + 0.13, w * 0.5, 0.22, 0.004, COLOR.frame);
}

/** Лаборатория яруса tier на участке 2x2 с центром (u0, f0). */
export function labBuilding(g: GeoBuilder, o: Frame, u0: number, f0: number, y0: number, tier: number, seed: number) {
  const site = houseKit(g, o, u0, f0, y0);
  // Плита двора, рампа баллонов с газами в клетке
  site.box(0, 0, 0, 1.9, 0.015, 1.9, COLOR.concrete);
  const gas = (u: number, f: number) => {
    site.box(u, 0.015, f, 0.26, 0.012, 0.14, COLOR.plinth);
    for (let i = 0; i < 4; i++) site.cyl(u - 0.09 + i * 0.06, f, 0.027, 0.022, 0.2, COLOR.gas[i % 3], 8, COLOR.steel);
    for (const e of [-1, 1]) site.box(u + e * 0.13, 0.015, f, 0.008, 0.24, 0.14, COLOR.steel);
  };
  if (tier <= 1) {
    const k = houseKit(g, o, u0, f0 - 0.15, y0);
    const top = labBlock(k, 1.5, 0.85, 2, seed, 0.3);
    entrance(k, 0.85, 0.3);
    roofKit(k, 1.5, 0.85, top, seed);
    gas(0.7, 0.62);
  } else if (tier === 2) {
    const k = houseKit(g, o, u0, f0 - 0.2, y0);
    const top = labBlock(k, 1.6, 1.0, 3, seed, 0.44);
    // Атриум на всю высоту в центре фасада
    k.box(0, PLINTH, 0.52, 0.44, 3 * FLOOR + 0.06, 0.1, COLOR.atrium, COLOR.roof);
    for (let i = 1; i < 4; i++) k.box(-0.22 + i * 0.11, PLINTH, 0.575, 0.008, 3 * FLOOR + 0.06, 0.008, COLOR.frame);
    for (let fl = 1; fl <= 3; fl++) k.box(0, PLINTH + fl * FLOOR, 0.575, 0.44, 0.01, 0.008, COLOR.frame);
    entrance(k, 1.12, 0.36);
    dome(k, -0.45, -0.15, top, 0.22);
    roofKit(k, 1.6, 1.0, top, seed);
    gas(0.68, 0.72);
  } else {
    // Башня центра в глубине и корпус у улицы, переход на уровне второго этажа
    const tower = houseKit(g, o, u0 - 0.4, f0 - 0.4, y0);
    const tt = labBlock(tower, 0.85, 0.85, 6, seed);
    roofKit(tower, 0.85, 0.85, tt, seed + 3);
    tower.box(0, tt, 0, 0.5, 0.12, 0.5, COLOR.wall, COLOR.roof);
    tower.box(0, tt + 0.12, 0, 0.04, 0.5, 0.04, COLOR.metal);
    beacon(g, o, u0 - 0.4, f0 - 0.4, y0 + tt + 0.64, seed * 3.3);
    const annex = houseKit(g, o, u0 + 0.4, f0 + 0.5, y0);
    const at = labBlock(annex, 0.9, 0.7, 2, seed + 11, 0.3);
    entrance(annex, 0.7, 0.3);
    dome(annex, 0.15, -0.05, at, 0.2);
    site.box(-0.012, PLINTH + FLOOR, 0.09, 0.07, FLOOR * 0.8, 0.15, COLOR.atrium, COLOR.band);
    gas(0.62, -0.55);
  }
}

/** Радар на клетке с центром (u0, f0): будка, решётчатая мачта, наклонённая тарелка. */
export function radarStation(g: GeoBuilder, o: Frame, u0: number, f0: number, y0: number, seed: number) {
  const site = houseKit(g, o, u0, f0, y0);
  site.box(0, 0, 0, 0.86, 0.02, 0.86, COLOR.concrete);
  // Будка оператора с дверью и окном, кондиционер
  const hut = houseKit(g, o, u0 - 0.22, f0 + 0.22, y0);
  const hs = sidesOf(0.32, 0.26);
  hut.box(0, 0.02, 0, 0.32, 0.22, 0.26, COLOR.wall, COLOR.roof);
  hut.box(0, 0.22, 0, 0.35, 0.03, 0.29, COLOR.band, COLOR.roof);
  const front = hut.part(hs[0]);
  front(-0.07, 0.02, 0.005, 0.08, 0.16, 0.01, COLOR.band);
  front(0.07, 0.1, 0.004, 0.1, 0.07, 0.01, COLOR.glass);
  hut.light(hs[0], 'lab', 0.07, 0.1, 0.1, 0.07, seed * 2.7, LIGHT_LAB, 1);
  hut.part(hs[2])(0, 0.08, 0.02, 0.1, 0.08, 0.04, COLOR.steel);
  // Мачта: четыре стойки, сужающиеся пояса, площадка наверху
  const mu = 0.16, mf = -0.14, H = 0.78;
  for (const [a, b] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) site.box(mu + a * 0.08, 0.02, mf + b * 0.08, 0.018, H, 0.018, COLOR.steel);
  for (let y = 0.15; y < H; y += 0.16) {
    for (const s of [-1, 1]) {
      site.box(mu, 0.02 + y, mf + s * 0.08, 0.17, 0.01, 0.01, COLOR.steel);
      site.box(mu + s * 0.08, 0.02 + y, mf, 0.01, 0.01, 0.17, COLOR.steel);
    }
  }
  site.box(mu, 0.02 + H, mf, 0.24, 0.02, 0.24, COLOR.metal);
  site.cyl(mu, mf, 0.04 + H, 0.04, 0.08, COLOR.metal, 8);
  // Тарелка: конус от узла к ободу, наклон к небу, облучатель на штанге
  const [x, z] = o.at(u0 + mu, f0 + mf);
  const yaw = hash(seed, 5) * Math.PI * 2;
  const m = new THREE.Matrix4().makeTranslation(x, y0 + 0.14 + H, z)
    .multiply(new THREE.Matrix4().makeRotationY(yaw))
    .multiply(new THREE.Matrix4().makeRotationX(-0.75));
  g.cylinder(m, 0.05, 0.1, COLOR.steel, 14, COLOR.dish, 0.3);
  g.cylinder(m.clone().multiply(new THREE.Matrix4().makeTranslation(0, 0.1, 0)), 0.012, 0.2, COLOR.metal, 6);
  beacon(g, o, u0 + mu + 0.1, f0 + mf - 0.1, y0 + H + 0.06, seed * 7.7);
}
