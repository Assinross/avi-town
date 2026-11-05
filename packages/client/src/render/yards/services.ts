// Дворы служб на участке 2x2: школа со спортплощадкой, лазарет с зоной ожидания.
// Оси совпадают с корпусами buildings/services.ts; все предметы остаются внутри участка.
import type { GeoBuilder } from '../builder';
import { houseKit, type Frame } from '../buildings/parts';
import { PALETTE } from '../palette';
import { placeProp, type PropDef } from '../props';
import { BENCH } from '../props/bench';
import { FLOWER_BED } from '../props/flowerBed';
import { PULLUP_BAR } from '../props/pullupBar';
import { TRASH_BIN } from '../props/trashBin';

const GROUND = 0.012;

function yardKit(g: GeoBuilder, o: Frame, seed: number) {
  const { box, cyl } = houseKit(g, o, 0, 0, 0);
  const prop = (def: PropDef, u: number, f: number, turn = 0) => {
    const [x, z] = o.at(u, f);
    placeProp(g, def, Math.floor(seed) % def.variants, x, GROUND + 0.003, z, o.rot + turn);
  };
  const flat = (u: number, f: number, su: number, sf: number, color: number, top = GROUND + 0.002) => box(u, 0, f, su, top, sf, color);
  const fence = (u0: number, f0: number, u1: number, f1: number, height = 0.12) => {
    const length = Math.hypot(u1 - u0, f1 - f0), along = u0 !== u1;
    for (const y of [0.035, height - 0.015]) box((u0 + u1) / 2, GROUND + y, (f0 + f1) / 2, along ? length : 0.008, 0.008, along ? 0.008 : length, PALETTE.metal[1]);
    const n = Math.max(1, Math.ceil(length / 0.14));
    for (let i = 0; i <= n; i++) box(u0 + (u1 - u0) * i / n, GROUND, f0 + (f1 - f0) * i / n, 0.012, height, 0.012, PALETTE.metal[1]);
  };
  flat(0, 0, 1.94, 1.94, PALETTE.lawn, GROUND);
  return { box, cyl, prop, flat, fence };
}

export function schoolYard(g: GeoBuilder, o: Frame, seed: number) {
  const { box, cyl, prop, flat, fence } = yardKit(g, o, seed);
  // Вход не упирается в поле: основная дорожка справа, короткая ветка к дверям корпуса.
  flat(0.28, 0.43, 0.16, 1.06, PALETTE.concrete[2]);
  flat(0.14, -0.07, 0.44, 0.14, PALETTE.concrete[2]);
  flat(0.65, 0.44, 0.54, 0.94, PALETTE.concrete[0]);
  // Поле: торцевые линии, центральная линия, круг и двое ворот.
  flat(-0.42, 0.48, 0.9, 0.62, PALETTE.leaves[0], GROUND + 0.004);
  for (const f of [0.19, 0.77]) box(-0.42, GROUND + 0.004, f, 0.86, 0.002, 0.009, PALETTE.marking);
  for (const u of [-0.84, -0.42, 0]) box(u, GROUND + 0.004, 0.48, 0.009, 0.002, 0.58, PALETTE.marking);
  cyl(-0.42, 0.48, GROUND + 0.004, 0.06, 0.002, PALETTE.marking, 16);
  cyl(-0.42, 0.48, GROUND + 0.006, 0.05, 0.001, PALETTE.leaves[0], 16);
  for (const u of [-0.84, 0]) {
    for (const f of [0.36, 0.6]) box(u, GROUND + 0.004, f, 0.01, 0.14, 0.01, PALETTE.frame);
    box(u, GROUND + 0.144, 0.48, 0.01, 0.01, 0.25, PALETTE.frame);
    const back = u < -0.42 ? -0.06 : 0.06;
    for (const f of [0.36, 0.6]) box(u + back / 2, GROUND + 0.004, f, 0.07, 0.008, 0.008, PALETTE.frame);
    box(u + back, GROUND + 0.004, 0.48, 0.008, 0.008, 0.25, PALETTE.frame);
  }
  // Низкое ограждение удерживает мяч, справа остаётся проход на площадку.
  fence(-0.93, 0.11, -0.93, 0.86, 0.18);
  fence(-0.93, 0.11, 0.1, 0.11, 0.18);
  fence(-0.93, 0.86, 0.1, 0.86, 0.18);
  prop(PULLUP_BAR, 0.65, 0.16);
  prop(BENCH, 0.65, 0.5, Math.PI / 2);
  prop(TRASH_BIN, 0.82, 0.7);
  prop(FLOWER_BED, 0.65, 0.83);
  // Ограждение участка с калиткой напротив дорожки.
  fence(-0.96, -0.96, -0.96, 0.96);
  fence(0.96, -0.96, 0.96, 0.96);
  fence(-0.96, -0.96, 0.96, -0.96);
  fence(-0.96, 0.96, 0.16, 0.96);
  fence(0.4, 0.96, 0.96, 0.96);
}

export function clinicYard(g: GeoBuilder, o: Frame, seed: number) {
  const { box, prop, flat } = yardKit(g, o, seed);
  // Сквозной проход от улицы к пандусу, мощение перед зоной ожидания.
  flat(0, 0.75, 0.34, 0.48, PALETTE.concrete[2]);
  flat(-0.51, 0.74, 0.62, 0.42, PALETTE.concrete[0]);
  flat(-0.3, 0.66, 0.5, 0.12, PALETTE.concrete[2]);
  prop(BENCH, -0.52, 0.6);
  prop(BENCH, -0.52, 0.85, Math.PI);
  prop(TRASH_BIN, -0.78, 0.6);
  prop(FLOWER_BED, -0.81, 0.85);
  prop(FLOWER_BED, -0.87, 0.25);
  prop(FLOWER_BED, 0.87, 0.25);
  // Свободное место для скорой у входа: разметка и медицинский крест, без декоративной машины.
  flat(0.64, 0.75, 0.36, 0.4, PALETTE.asphalt, GROUND + 0.003);
  for (const u of [0.47, 0.81]) box(u, GROUND + 0.003, 0.75, 0.009, 0.002, 0.38, PALETTE.marking);
  box(0.64, GROUND + 0.003, 0.56, 0.34, 0.002, 0.009, PALETTE.marking);
  box(0.64, GROUND + 0.003, 0.75, 0.15, 0.003, 0.045, PALETTE.clinicCross);
  box(0.64, GROUND + 0.003, 0.75, 0.045, 0.003, 0.15, PALETTE.clinicCross);
  // Низкие столбики отделяют пешеходный вход от подъезда скорой.
  for (const f of [0.62, 0.88]) box(0.34, GROUND, f, 0.018, 0.09, 0.018, PALETTE.signs[1]);
}
