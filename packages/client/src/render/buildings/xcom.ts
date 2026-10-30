// Рецепты зданий XCOM (plan.md 010, этап 5): мастерская - цех из стальных панелей с синей
// полосой, воротами в жёлто-чёрную полоску и световыми фонарями на крыше; застава - ангар
// броневика под двускатной крышей, окна казармы и вышка с прожектором.
// Детали - parts.ts, фасад - к +f. Двор (контейнеры, кран-балка, мешки) - в cityMesh.

import type { GeoBuilder } from '../builder';
import { houseKit, sidesOf, type Frame } from './parts';

const LIGHT_WORK = 0xffe2b0;

const COLOR = {
  panel: 0x8c9399,
  rib: 0x7d858c,
  plinth: 0x6f6862,
  roof: 0x5d7088,
  band: 0x2f6fb0,
  glass: 0x46596a,
  skylight: 0x9fc4d6,
  frame: 0x5d636b,
  gate: 0x6f767c,
  hazard: 0xe4bd37,
  black: 0x222222,
  metal: 0x57524d,
  military: 0x5d6b4a,
  militaryDark: 0x4a5639,
  roofMil: 0x4f5848,
  door: 0x4a3426,
};

/** Мастерская XCOM w x d с центром (u0, f0): ворота на фасаде, окна по бокам, фонари на крыше. */
export function xcomWorkshop(g: GeoBuilder, o: Frame, u0: number, f0: number, y0: number, w: number, d: number, seed: number) {
  const k = houseKit(g, o, u0, f0, y0);
  const sides = sidesOf(w, d);
  const H = 0.6, PL = 0.03;
  k.box(0, 0, 0, w + 0.01, PL, d + 0.01, COLOR.plinth);
  k.box(0, PL, 0, w, H, d, COLOR.panel, COLOR.roof);
  k.box(0, PL + H - 0.08, 0, w + 0.012, 0.06, d + 0.012, COLOR.band);
  k.box(0, PL + H, 0, w + 0.03, 0.03, d + 0.03, COLOR.frame, COLOR.roof);
  // Световые фонари поперёк крыши
  for (let i = 0; i < 3; i++) {
    const u = -w / 2 + (w * (i + 0.5)) / 3;
    k.box(u, PL + H + 0.03, 0, 0.16, 0.07, d * 0.7, COLOR.frame, COLOR.skylight);
  }
  sides.forEach((s, si) => {
    const p = k.part(s);
    for (let t = -s.len / 2 + 0.08; t < s.len / 2; t += 0.08) p(t, PL, 0.004, 0.012, H - 0.09, 0.008, COLOR.rib);
    if (si < 2) return;
    // Окна на боках
    for (const t of [-s.len * 0.25, s.len * 0.25]) {
      p(t, 0.28, 0.006, 0.22, 0.12, 0.01, COLOR.frame);
      p(t, 0.29, 0.01, 0.2, 0.1, 0.008, COLOR.glass);
      k.light(s, 'workshop', t, 0.29, 0.2, 0.1, seed + si * 5.1 + t, LIGHT_WORK, 2);
    }
  });
  // Большие ворота с полосами по краям, дверь, прожектор над воротами
  const front = k.part(sides[0]);
  const gw = w * 0.42, gh = 0.42, gt = -w * 0.15;
  front(gt, PL, 0.006, gw + 0.04, gh + 0.03, 0.012, COLOR.frame);
  front(gt, PL, 0.012, gw, gh, 0.01, COLOR.gate);
  for (let y = 0.05; y < gh; y += 0.05) front(gt, PL + y, 0.018, gw, 0.006, 0.006, COLOR.rib);
  for (const e of [-1, 1]) {
    for (let i = 0; i < 5; i++) front(gt + e * (gw / 2 + 0.035), PL + i * 0.08, 0.008, 0.03, 0.04, 0.012, COLOR.hazard);
    for (let i = 0; i < 5; i++) front(gt + e * (gw / 2 + 0.035), PL + i * 0.08 + 0.04, 0.008, 0.03, 0.04, 0.012, COLOR.black);
  }
  front(w * 0.3, PL, 0.006, 0.1, 0.22, 0.01, COLOR.door);
  front(w * 0.3, PL + 0.3, 0.006, 0.22, 0.1, 0.01, COLOR.glass);
  k.light(sides[0], 'workshop', w * 0.3, PL + 0.3, 0.22, 0.1, seed * 2.3, LIGHT_WORK, 2);
  front(gt, PL + gh + 0.05, 0.03, 0.06, 0.04, 0.05, COLOR.metal);
  k.light(sides[0], 'worklight', gt, PL + gh + 0.05, 0.08, 0.04, seed * 3.1, LIGHT_WORK, 1);
}

/** Ангар заставы w x d с центром (u0, f0): военная окраска, двускатная крыша, окна казармы на боках. */
export function outpostHangar(g: GeoBuilder, o: Frame, u0: number, f0: number, y0: number, w: number, d: number, seed: number) {
  const k = houseKit(g, o, u0, f0, y0);
  const sides = sidesOf(w, d);
  const H = 0.44, PL = 0.03;
  k.box(0, 0, 0, w + 0.01, PL, d + 0.01, COLOR.plinth);
  k.box(0, PL, 0, w, H, d, COLOR.military, COLOR.roofMil);
  // Двускатная крыша, конёк вглубь участка (щипец - к воротам)
  const [x, z] = o.at(u0, f0);
  const swap = Math.abs(Math.sin(o.rot)) > 0.5;
  g.gable(x, y0 + PL + H, z, swap ? d + 0.06 : w + 0.06, 0.24, swap ? w + 0.06 : d + 0.06, COLOR.roofMil, COLOR.military, !swap);
  sides.forEach((s, si) => {
    const p = k.part(s);
    p(0, PL, 0.004, s.len, 0.05, 0.008, COLOR.militaryDark);
    if (si < 2) return;
    const n = Math.max(2, Math.floor(s.len / 0.25));
    for (let i = 0; i < n; i++) {
      const t = -s.len / 2 + (s.len * (i + 0.5)) / n;
      p(t, 0.22, 0.004, 0.12, 0.09, 0.01, COLOR.frame);
      p(t, 0.225, 0.008, 0.1, 0.08, 0.008, COLOR.glass);
      k.light(s, 'window', t, 0.225, 0.1, 0.08, seed + si * 4.7 + i, LIGHT_WORK, 2);
    }
  });
  // Над воротами (их рисует cityMesh) - номер части и прожектор
  const front = k.part(sides[0]);
  front(0, PL + H + 0.04, 0.006, 0.2, 0.07, 0.008, COLOR.band);
  front(w * 0.35, PL + 0.36, 0.03, 0.05, 0.04, 0.05, COLOR.metal);
  k.light(sides[0], 'worklight', w * 0.35, PL + 0.36, 0.08, 0.04, seed * 1.7, LIGHT_WORK, 1);
  front(-w * 0.38, PL, 0.006, 0.09, 0.22, 0.01, COLOR.door);
}
