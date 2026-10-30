// Скамейка двора и сквера - образец предмета для render/props/ (README.md).
// Варианты: 3 цвета дерева x (со спинкой | лавка без спинки).

import * as THREE from 'three';
import { PALETTE, pick } from '../palette';
import type { PropDef } from './kit';

const LENGTH = 1.7;
const SEAT_Y = 0.42;
const SEAT_DEPTH = 0.44;

export const BENCH: PropDef = {
  id: 'bench',
  name: 'Скамейка',
  variants: 6,
  build(p, v) {
    const wood = pick(PALETTE.planks, v);
    const back = v < 3;
    // Чугунные боковины: стойка и лапа на земле
    for (const x of [-LENGTH * 0.38, LENGTH * 0.38]) {
      p.box(x, 0, 0.02, 0.06, SEAT_Y, 0.06, PALETTE.iron);
      p.box(x, 0, 0, 0.06, 0.04, SEAT_DEPTH, PALETTE.iron);
      p.box(x, SEAT_Y - 0.05, 0, 0.06, 0.05, SEAT_DEPTH, PALETTE.iron);
      if (back) p.boxAt(new THREE.Matrix4().makeRotationX(-0.22).setPosition(x, SEAT_Y, -SEAT_DEPTH / 2 + 0.04), 0.06, 0.44, 0.05, PALETTE.iron);
    }
    // Сиденье - три рейки с зазором
    for (let i = 0; i < 3; i++) p.box(0, SEAT_Y, -0.15 + i * 0.15, LENGTH, 0.04, 0.12, wood);
    if (!back) return;
    // Спинка - две рейки на наклонных стойках
    for (const h of [0.2, 0.36]) {
      const m = new THREE.Matrix4().makeRotationX(-0.22).multiply(new THREE.Matrix4().makeTranslation(0, h, 0));
      m.premultiply(new THREE.Matrix4().makeTranslation(0, SEAT_Y, -SEAT_DEPTH / 2 + 0.01));
      p.boxAt(m, LENGTH, 0.1, 0.035, wood);
    }
  },
};
