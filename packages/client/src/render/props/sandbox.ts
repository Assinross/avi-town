// Песочница двора: дощатый борт, песок, у части вариантов - грибок-навес.
// Варианты: 3 цвета досок PALETTE.planks x (без грибка | с грибком).

import * as THREE from 'three';
import { PALETTE, pick } from '../palette';
import type { PropDef } from './kit';

const S = 2.0;
const BOARD = 0.3;
const T = 0.06;

export const SANDBOX: PropDef = {
  id: 'sandbox',
  name: 'Песочница',
  variants: 3,
  build(p, v) {
    const wood = pick(PALETTE.planks, v);
    const woodTop = new THREE.Color(wood).multiplyScalar(1.1).getHex();
    const woodDark = new THREE.Color(wood).multiplyScalar(0.85).getHex();
    // Борт из двух досок с каждой стороны
    for (const z of [-S / 2 + T / 2, S / 2 - T / 2]) {
      p.box(0, 0, z, S, BOARD / 2, T, wood);
      p.box(0, BOARD / 2, z, S, BOARD / 2, T, woodTop);
    }
    for (const x of [-S / 2 + T / 2, S / 2 - T / 2]) {
      p.box(x, 0, 0, T, BOARD / 2, S - 2 * T, wood);
      p.box(x, BOARD / 2, 0, T, BOARD / 2, S - 2 * T, woodTop);
    }
    // Угловые столбики выше борта
    for (const x of [-S / 2 + 0.05, S / 2 - 0.05]) {
      for (const z of [-S / 2 + 0.05, S / 2 - 0.05]) p.box(x, 0, z, 0.1, BOARD + 0.05, 0.1, woodDark);
    }
    // Песок внутри
    p.box(0, 0.01, 0, S - 2 * T, 0.12, S - 2 * T, PALETTE.sand);
    if (v === 0) return;
    // Грибок: столб и ступенчатая шляпка
    const cap = pick(PALETTE.play, v);
    const capDark = new THREE.Color(cap).multiplyScalar(0.85).getHex();
    p.cylinder(0, 0, -0.55, 0.07, 1.55, PALETTE.frame, 'y', 8);
    p.cylinder(0, 1.55, -0.55, 0.78, 0.12, cap, 'y', 10);
    p.cylinder(0, 1.67, -0.55, 0.62, 0.14, cap, 'y', 10);
    p.cylinder(0, 1.81, -0.55, 0.42, 0.14, capDark, 'y', 10);
    p.cylinder(0, 1.95, -0.55, 0.2, 0.1, capDark, 'y', 8);
  },
};
