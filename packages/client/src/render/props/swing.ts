// Качели двора: А-образная рама, одно или два сиденья на цепях (README.md: метры, фасад к +z).
// Варианты: 4 цвета рамы PALETTE.play x (одно сиденье | два).

import * as THREE from 'three';
import { PALETTE, pick } from '../palette';
import type { PropDef } from './kit';

const W = 2.4;
const H = 2.1;
const D = 1.4;
const BAR_Y = H - 0.055;
const FOOT = 0.04;
const LEG_Z = D / 2 - 0.08;
const LEG_TILT = Math.atan2(LEG_Z, BAR_Y - FOOT);
const LEG_LEN = Math.hypot(LEG_Z, BAR_Y - FOOT);

export const SWING: PropDef = {
  id: 'swing',
  name: 'Качели',
  variants: 4,
  build(p, v) {
    const frame = pick(PALETTE.play, v);
    const wood = pick(PALETTE.planks, v);
    const seats = v >= 2 ? [-0.55, 0.55] : [0];
    // Лапы на земле и наклонные стойки А-образной рамы
    for (const x of [-W / 2 + 0.1, W / 2 - 0.1]) {
      for (const z of [-LEG_Z, LEG_Z]) {
        p.box(x, 0, z, 0.14, FOOT, 0.14, PALETTE.iron);
        const m = new THREE.Matrix4().makeRotationX(-Math.sign(z) * LEG_TILT).setPosition(x, FOOT, z);
        p.boxAt(m, 0.07, LEG_LEN, 0.07, frame);
      }
      // Нижняя распорка между стойками
      p.box(x, 0.55, 0, 0.05, 0.05, LEG_Z * 1.45, frame);
    }
    // Верхняя перекладина
    p.cylinder(-W / 2, BAR_Y, 0, 0.055, W, frame, 'x', 8);
    // Сиденья: железная рамка, три доски, цепи к перекладине
    for (const x of seats) {
      p.box(x, 0.53, 0, 0.5, 0.03, 0.32, PALETTE.iron);
      for (let i = 0; i < 3; i++) p.box(x, 0.56, -0.1 + i * 0.1, 0.46, 0.04, 0.08, wood);
      for (const dx of [-0.18, 0.18]) p.box(x + dx, 0.56, 0, 0.025, BAR_Y - 0.055 - 0.56, 0.025, PALETTE.wire);
    }
  },
};
