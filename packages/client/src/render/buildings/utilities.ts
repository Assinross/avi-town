// Рецепты коммунальных зданий (plan.md 010, этап 5): электростанция - бетонный машинный зал
// с лентами высоких окон и фонарём на крыше, градирня, полосатая труба, баки топлива и
// подстанция с трансформаторами; водокачка - кирпичная насосная под двускатной крышей и
// водонапорная башня на решётчатых опорах. Детали - parts.ts, фасад - к +f.

import type { GeoBuilder } from '../builder';
import { hash, houseKit, sidesOf, type Frame } from './parts';

const LIGHT_WORK = 0xffe2b0;
const LIGHT_BEACON = 0xff4a3a;

const COLOR = {
  panel: 0xb8b2a6,
  pilaster: 0x9d978b,
  plinth: 0x6f6862,
  roof: 0x4a4744,
  glass: 0x46596a,
  frame: 0x5d636b,
  gate: 0x8c9399,
  tower: 0xc9c4ba,
  towerTop: 0x3a3836,
  white: 0xe8e4dc,
  red: 0xb8392e,
  tank: 0xc8c2b6,
  metal: 0x57524d,
  steel: 0x8c9399,
  transformer: 0x6b7a6f,
  insulator: 0xd8d0c0,
  gravel: 0x8d8a82,
  brick: 0x9c4e3b,
  stone: 0xcfc6b4,
  door: 0x4a3426,
  water: 0x5d8fa8,
  hazard: 0xd8a23a,
};

/** Красный маячок на верхушке (труба, башня, мачта) - горит всю ночь. */
export function beacon(g: GeoBuilder, o: Frame, u: number, f: number, y: number, seed: number) {
  const [x, z] = o.at(u, f);
  g.light('beacon', x, y, z, 0, seed, LIGHT_BEACON, 0.05, 0.05, 1);
}

/** Электростанция на участке 2x2 с центром (u0, f0): зал у улицы, градирня и труба в глубине. */
export function powerPlant(g: GeoBuilder, o: Frame, u0: number, f0: number, y0: number, seed: number) {
  const site = houseKit(g, o, u0, f0, y0);
  // Машинный зал: бетонные панели между пилястрами, ленты высоких окон, ворота, фонарь на крыше
  const hw = 1.1, hd = 0.85, H = 0.95, PL = 0.03;
  const hall = houseKit(g, o, u0 - 0.35, f0 + 0.32, y0);
  const sides = sidesOf(hw, hd);
  hall.box(0, 0, 0, hw + 0.01, PL, hd + 0.01, COLOR.plinth);
  hall.box(0, PL, 0, hw, H, hd, COLOR.panel, COLOR.roof);
  hall.box(0, PL + H - 0.03, 0, hw + 0.03, 0.04, hd + 0.03, COLOR.pilaster, COLOR.roof);
  hall.box(0, PL + H, 0, hw * 0.8, 0.12, hd * 0.34, COLOR.glass, COLOR.roof);
  hall.box(0, PL + H + 0.12, 0, hw * 0.84, 0.02, hd * 0.4, COLOR.roof);
  for (const u of [-0.38, 0.3]) hall.box(u, PL + H, -hd * 0.32, 0.1, 0.07, 0.1, COLOR.steel);
  const gateT = hw * 0.3;
  sides.forEach((s, si) => {
    const part = hall.part(s);
    const n = Math.max(2, Math.round(s.len / 0.18));
    const step = s.len / n;
    for (let i = 0; i <= n; i++) part(-s.len / 2 + step * i, PL, 0.004, 0.035, H - 0.03, 0.015, COLOR.pilaster);
    for (let i = 0; i < n; i++) {
      const t = -s.len / 2 + step * (i + 0.5);
      if (si === 0 && Math.abs(t - gateT) < 0.15) continue;
      part(t, 0.32, 0, step * 0.55 + 0.02, 0.52, 0.01, COLOR.frame);
      part(t, 0.33, 0.005, step * 0.55, 0.5, 0.008, COLOR.glass);
      for (const y of [0.49, 0.66]) part(t, y, 0.008, step * 0.55, 0.012, 0.01, COLOR.frame);
      hall.light(s, 'worklight', t, 0.33, step * 0.55, 0.5, seed + si * 9.1 + i * 1.7, LIGHT_WORK, 2);
    }
  });
  const front = hall.part(sides[0]);
  front(gateT, PL, 0, 0.26, 0.36, 0.012, COLOR.frame);
  front(gateT, PL, 0.007, 0.23, 0.34, 0.01, COLOR.gate);
  for (let y = 0.04; y < 0.34; y += 0.04) front(gateT, PL + y, 0.012, 0.23, 0.006, 0.006, COLOR.frame);
  front(gateT, PL + 0.37, 0.03, 0.3, 0.02, 0.06, COLOR.roof);
  hall.light(sides[0], 'worklight', gateT, PL + 0.4, 0.08, 0.04, seed * 1.3, LIGHT_WORK, 1);
  // Градирня: гиперболоид из двух усечённых конусов, тёмное горло, ступени основания
  const tu = 0.5, tf = -0.42;
  site.cyl(tu, tf, 0, 0.45, 0.06, COLOR.plinth, 16);
  site.cyl(tu, tf, 0.06, 0.42, 0.72, COLOR.tower, 16, COLOR.tower, 0.27);
  site.cyl(tu, tf, 0.78, 0.27, 0.44, COLOR.tower, 16, COLOR.towerTop, 0.31);
  site.cyl(tu, tf, 1.2, 0.26, 0.012, COLOR.towerTop, 16);
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2;
    site.box(tu + Math.cos(a) * 0.41, 0, tf + Math.sin(a) * 0.41, 0.04, 0.1, 0.04, COLOR.pilaster);
  }
  // Труба: белая с красными полосами, площадка обслуживания, маячок на верхушке
  const cu = -0.84, cf = -0.28, ch = 2.3;
  site.cyl(cu, cf, 0, 0.1, 0.08, COLOR.plinth, 10);
  site.cyl(cu, cf, 0.08, 0.085, ch, COLOR.white, 10, COLOR.towerTop, 0.055);
  for (const k of [0.62, 0.78, 0.94]) site.cyl(cu, cf, 0.08 + ch * k, 0.087 - 0.03 * k, ch * 0.08, COLOR.red, 10, COLOR.red, 0.085 - 0.03 * k);
  site.cyl(cu, cf, 0.08 + ch * 0.55, 0.1, 0.015, COLOR.metal, 10);
  beacon(g, o, u0 + cu, f0 + cf, y0 + 0.08 + ch + 0.02, seed * 2.1);
  // Баки топлива на бетонных подушках, обвязка трубами к залу
  for (const [u, f] of [[-0.62, -0.62], [-0.22, -0.66]] as const) {
    site.box(u, 0, f, 0.38, 0.03, 0.38, COLOR.plinth);
    site.cyl(u, f, 0.03, 0.16, 0.3, COLOR.tank, 14, COLOR.steel);
    site.cyl(u, f, 0.33, 0.16, 0.04, COLOR.steel, 14, COLOR.steel, 0.1);
    site.box(u + 0.12, 0.03, f, 0.012, 0.32, 0.012, COLOR.metal);
  }
  site.box(-0.42, 0.18, -0.4, 0.04, 0.04, 0.3, COLOR.metal);
  // Эстакада труб от зала к градирне
  site.box(0.3, 0.42, 0.0, 0.45, 0.05, 0.05, COLOR.steel);
  for (const u of [0.12, 0.45]) site.box(u, 0, 0.0, 0.03, 0.42, 0.03, COLOR.metal);
  // Подстанция: гравий, ограда, трансформаторы и портал с изоляторами
  const su = 0.58, sf = 0.55;
  site.box(su, 0, sf, 0.62, 0.012, 0.62, COLOR.gravel);
  for (const k of [-0.3, -0.1, 0.1, 0.3]) {
    site.box(su + k, 0, sf - 0.3, 0.012, 0.14, 0.012, COLOR.steel);
    site.box(su + k, 0, sf + 0.3, 0.012, 0.14, 0.012, COLOR.steel);
    site.box(su - 0.3, 0, sf + k, 0.012, 0.14, 0.012, COLOR.steel);
    site.box(su + 0.3, 0, sf + k, 0.012, 0.14, 0.012, COLOR.steel);
  }
  for (const [a, b] of [[0, -0.3], [0, 0.3], [-0.3, 0], [0.3, 0]] as const) {
    site.box(su + a, 0.12, sf + b, a ? 0.006 : 0.6, 0.006, a ? 0.6 : 0.006, COLOR.steel);
  }
  for (const u of [-0.13, 0.13]) {
    site.box(su + u, 0.012, sf + 0.1, 0.16, 0.14, 0.12, COLOR.transformer);
    for (const d of [-0.05, 0, 0.05]) site.cyl(su + u + d, sf + 0.1, 0.152, 0.01, 0.05, COLOR.insulator, 6);
    for (const d of [-0.04, 0.04]) site.box(su + u + 0.09, 0.03, sf + 0.1 + d, 0.012, 0.1, 0.03, COLOR.metal);
  }
  for (const u of [-0.24, 0.24]) site.box(su + u, 0.012, sf - 0.15, 0.025, 0.5, 0.025, COLOR.steel);
  site.box(su, 0.5, sf - 0.15, 0.52, 0.025, 0.025, COLOR.steel);
  for (const u of [-0.15, 0, 0.15]) site.cyl(su + u, sf - 0.15, 0.4, 0.012, 0.1, COLOR.insulator, 6);
  site.box(su, 0.012, sf + 0.31, 0.08, 0.06, 0.006, COLOR.hazard);
}

/** Водокачка на клетке с центром (u0, f0): насосная у улицы, башня в глубине. */
export function pumpStation(g: GeoBuilder, o: Frame, u0: number, f0: number, y0: number, seed: number) {
  const site = houseKit(g, o, u0, f0, y0);
  // Насосная: кирпич, двускатная крыша, дверь, окно, фонарь над дверью
  const pw = 0.4, pd = 0.32, ph = 0.28;
  const ph0 = houseKit(g, o, u0 - 0.2, f0 + 0.2, y0);
  const sides = sidesOf(pw, pd);
  ph0.box(0, 0, 0, pw + 0.01, 0.03, pd + 0.01, COLOR.plinth);
  ph0.box(0, 0.03, 0, pw, ph, pd, COLOR.brick);
  const [rx, rz] = o.at(u0 - 0.2, f0 + 0.2);
  const swap = Math.abs(Math.sin(o.rot)) > 0.5;
  g.gable(rx, y0 + 0.03 + ph, rz, swap ? pd + 0.06 : pw + 0.06, 0.13, swap ? pw + 0.06 : pd + 0.06, COLOR.roof, COLOR.brick, swap);
  const front = ph0.part(sides[0]);
  front(-0.08, 0.03, 0.006, 0.1, 0.19, 0.01, COLOR.door);
  front(-0.08, 0.03 + 0.19, 0, 0.13, 0.015, 0.012, COLOR.stone);
  front(0.1, 0.13, 0, 0.12, 0.1, 0.01, COLOR.frame);
  front(0.1, 0.135, 0.005, 0.1, 0.09, 0.008, COLOR.glass);
  ph0.light(sides[0], 'worklight', -0.08, 0.25, 0.05, 0.03, seed * 4.9, LIGHT_WORK, 2);
  ph0.light(sides[0], 'window', 0.1, 0.135, 0.1, 0.09, seed * 3.7, LIGHT_WORK, 1);
  for (const s of sides.slice(2)) {
    const p = ph0.part(s);
    p(0, 0.13, 0, 0.12, 0.1, 0.01, COLOR.frame);
    p(0, 0.135, 0.005, 0.1, 0.09, 0.008, COLOR.glass);
  }
  // Водонапорная башня: четыре опоры с раскосами, бак с поясами, коническая крыша, лестница
  const bu = 0.18, bf = -0.18, legH = 0.62, r = 0.17;
  for (const [a, b] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
    site.box(bu + a * 0.11, 0, bf + b * 0.11, 0.035, 0.03, 0.035, COLOR.plinth);
    site.box(bu + a * 0.1, 0.03, bf + b * 0.1, 0.022, legH, 0.022, COLOR.steel);
  }
  for (const y of [0.22, 0.44]) {
    for (const s of [-1, 1]) {
      site.box(bu, y, bf + s * 0.1, 0.2, 0.012, 0.012, COLOR.steel);
      site.box(bu + s * 0.1, y, bf, 0.012, 0.012, 0.2, COLOR.steel);
    }
  }
  site.cyl(bu, bf, 0.03, 0.025, legH, COLOR.metal, 6);
  site.cyl(bu, bf, 0.03 + legH, r, 0.03, COLOR.metal, 14);
  site.cyl(bu, bf, 0.06 + legH, r, 0.22, COLOR.water, 14);
  for (const y of [0.1, 0.18]) site.cyl(bu, bf, legH + y, r + 0.004, 0.012, COLOR.steel, 14);
  site.cyl(bu, bf, 0.28 + legH, r + 0.015, 0.1, COLOR.roof, 14, COLOR.roof, 0.02);
  site.box(bu + r + 0.01, 0.03, bf, 0.012, legH + 0.25, 0.04, COLOR.metal);
  beacon(g, o, u0 + bu, f0 + bf, y0 + 0.39 + legH, seed * 6.3);
  // Труба от башни к насосной и люк колодца
  site.box(-0.02, 0.06, 0.02, 0.32, 0.03, 0.03, COLOR.metal, COLOR.metal);
  site.cyl(0.32, 0.3, 0, 0.06, 0.03, COLOR.plinth, 10, COLOR.metal);
  if (hash(seed, 1) < 0.5) site.box(-0.36, 0, -0.3, 0.12, 0.08, 0.1, COLOR.hazard, COLOR.metal);
}
