// Бельевые столбы двора: две стойки с перекладинами, три верёвки, бельё.
// Варианты: 4 - пустые | три набора белья (цвета PALETTE.paint и PALETTE.frame).

import { PALETTE, pick } from '../palette';
import type { PropDef } from './kit';

const SPAN = 3.2;
const H = 1.9;
const WIRE_Y = 1.84;
const ZS = [-0.3, 0, 0.3];

export const CLOTHESLINE: PropDef = {
  id: 'clothesline',
  name: 'Бельевые столбы',
  variants: 4,
  build(p, v) {
    // Столбы на бетонных пятках, перекладина под три верёвки
    for (const x of [-SPAN / 2, SPAN / 2]) {
      p.box(x, 0, 0, 0.22, 0.12, 0.22, pick(PALETTE.concrete, 1));
      p.box(x, 0, 0, 0.1, H, 0.1, PALETTE.trunk);
      p.box(x, H - 0.08, 0, 0.08, 0.07, 0.7, PALETTE.trunk);
    }
    for (const z of ZS) p.box(0, WIRE_Y, z, SPAN, 0.015, 0.015, PALETTE.wire);
    if (v === 0) return;
    // Полотнище с перегибом через верёвку и прищепки по краям
    const hang = (x: number, z: number, w: number, h: number, color: number) => {
      p.box(x, WIRE_Y - h, z, w, h, 0.03, color);
      p.box(x, WIRE_Y - 0.02, z, w + 0.04, 0.05, 0.08, color);
      for (const dx of [-w / 2 + 0.04, w / 2 - 0.04]) p.box(x + dx, WIRE_Y, z + 0.03, 0.025, 0.07, 0.03, PALETTE.iron);
    };
    if (v === 1) {
      hang(-0.9, ZS[2], 0.7, 0.7, PALETTE.frame);
      hang(0, ZS[2], 0.45, 0.5, pick(PALETTE.paint, 1));
      hang(0.8, ZS[2], 0.3, 0.3, pick(PALETTE.paint, 0));
    } else if (v === 2) {
      hang(-0.8, ZS[1], 0.6, 0.65, pick(PALETTE.paint, 2));
      hang(0.15, ZS[1], 0.5, 0.45, PALETTE.frame);
      hang(0.85, ZS[2], 0.4, 0.45, pick(PALETTE.paint, 3));
      hang(-0.2, ZS[0], 0.3, 0.35, pick(PALETTE.paint, 4));
    } else {
      hang(-0.7, ZS[2], 0.8, 0.8, PALETTE.frame);
      hang(0.6, ZS[0], 0.7, 0.7, pick(PALETTE.paint, 1));
      hang(-0.1, ZS[1], 0.4, 0.4, pick(PALETTE.paint, 4));
    }
  },
};
