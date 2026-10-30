// Горка двора: лестница сзади, площадка с перилами, скат к фасаду (+z).
// Варианты: 3 цвета ската PALETTE.play.

import * as THREE from 'three';
import { PALETTE, pick } from '../palette';
import type { PropDef } from './kit';

const W = 0.8;
const PLAT_Y = 1.0;
const PLAT_Z = -0.8;
const PLAT_D = 0.8;
const RAIL_TOP = 1.54;
const LADDER_Z = -1.5;
const CHUTE_Z0 = -0.4;
const CHUTE_Z1 = 1.65;
const CHUTE_Y0 = 1.0;
const CHUTE_Y1 = 0.12;
const CHUTE_LEN = Math.hypot(CHUTE_Z1 - CHUTE_Z0, CHUTE_Y0 - CHUTE_Y1);
const CHUTE_ANGLE = Math.atan2(CHUTE_Y0 - CHUTE_Y1, CHUTE_Z1 - CHUTE_Z0);

export const SLIDE: PropDef = {
  id: 'slide',
  name: 'Горка',
  variants: 3,
  build(p, v) {
    const chute = pick(PALETTE.play, v);
    const chuteSide = new THREE.Color(chute).multiplyScalar(0.82).getHex();
    const metal = pick(PALETTE.metal, 0);
    const dark = pick(PALETTE.metal, 1);
    // Стойки площадки и перила по бокам
    for (const x of [-0.34, 0.34]) {
      for (const z of [PLAT_Z - PLAT_D / 2 + 0.06, PLAT_Z + PLAT_D / 2 - 0.06]) {
        p.box(x, 0, z, 0.07, PLAT_Y, 0.07, metal);
      }
      // Задние стойки выше площадки - под перила
      p.box(x, PLAT_Y, PLAT_Z - PLAT_D / 2 + 0.06, 0.07, RAIL_TOP - PLAT_Y, 0.07, metal);
      p.box(x, RAIL_TOP, PLAT_Z, 0.05, 0.06, PLAT_D - 0.12, metal);
      p.box(x, 1.27, PLAT_Z, 0.05, 0.05, PLAT_D - 0.12, dark);
    }
    // Площадка и заднее ограждение
    p.box(0, PLAT_Y, PLAT_Z, W, 0.06, PLAT_D, metal);
    p.box(0, RAIL_TOP, PLAT_Z - PLAT_D / 2 + 0.06, W, 0.06, 0.05, metal);
    // Лестница сзади: наклонные тетивы и ступени
    const ladderTilt = Math.atan2(0.3, 1.0);
    for (const x of [-0.28, 0.28]) {
      const m = new THREE.Matrix4().makeRotationX(ladderTilt).setPosition(x, 0.01, LADDER_Z);
      p.boxAt(m, 0.06, Math.hypot(1.0, 0.3), 0.06, metal);
    }
    for (const y of [0.2, 0.45, 0.7, 0.95]) {
      p.box(0, y, LADDER_Z + 0.3 * (y / 1.0), 0.56, 0.05, 0.05, metal);
    }
    // Скат: наклонная плита и бортики
    const mid = new THREE.Matrix4().makeRotationX(CHUTE_ANGLE)
      .setPosition(0, (CHUTE_Y0 + CHUTE_Y1) / 2, (CHUTE_Z0 + CHUTE_Z1) / 2);
    p.boxAt(mid, W, 0.06, CHUTE_LEN, chute);
    for (const dx of [-W / 2 + 0.03, W / 2 - 0.03]) {
      p.boxAt(mid.clone().multiply(new THREE.Matrix4().makeTranslation(dx, 0.06, 0)), 0.06, 0.14, CHUTE_LEN, chuteSide);
    }
    // Подпорка под концом ската
    p.box(0, 0, CHUTE_Z1 - 0.02, 0.6, 0.12, 0.08, metal);
  },
};
