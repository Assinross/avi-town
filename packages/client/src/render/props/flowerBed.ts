// Клумба двора: дощатый борт, земля и цветы.
// Варианты: 4 - квадратная/круглая x цвета цветов PALETTE.play / PALETTE.signs.

import * as THREE from 'three';
import { PALETTE, pick } from '../palette';
import type { PropDef } from './kit';

const S = 1.4;
const BORDER = 0.25;
const T = 0.06;

/** Пять цветов по кругу и один в центре - подходят и квадрату, и кругу. */
const SPOTS: [number, number][] = [
  [0, 0],
  [0, 0.38],
  [-0.36, 0.12],
  [-0.22, -0.31],
  [0.22, -0.31],
  [0.36, 0.12],
];

export const FLOWER_BED: PropDef = {
  id: 'flowerBed',
  name: 'Клумба',
  variants: 4,
  build(p, v) {
    const round = v >= 2;
    const flowers = v % 2 === 0 ? PALETTE.play : PALETTE.signs;
    const wood = pick(PALETTE.planks, v);
    if (round) {
      p.cylinder(0, 0, 0, S / 2, BORDER, wood, 'y', 10);
      p.cylinder(0, BORDER - 0.02, 0, S / 2 - 0.08, 0.04, PALETTE.earth, 'y', 10);
    } else {
      for (const z of [-S / 2 + T / 2, S / 2 - T / 2]) p.box(0, 0, z, S, BORDER, T, wood);
      for (const x of [-S / 2 + T / 2, S / 2 - T / 2]) p.box(x, 0, 0, T, BORDER, S - 2 * T, wood);
      for (const x of [-S / 2 + 0.05, S / 2 - 0.05]) {
        for (const z of [-S / 2 + 0.05, S / 2 - 0.05]) {
          p.box(x, 0, z, 0.1, BORDER + 0.02, 0.1, new THREE.Color(wood).multiplyScalar(0.85).getHex());
        }
      }
      p.box(0, 0.02, 0, S - 2 * T, BORDER - 0.05, S - 2 * T, PALETTE.earth);
    }
    // Цветы: стебель, лист и головка
    SPOTS.forEach(([x, z], i) => {
      const head = pick(flowers, i);
      const leaf = pick(PALETTE.leaves, i);
      p.box(x, BORDER - 0.05, z, 0.025, 0.34, 0.025, leaf);
      p.box(x + 0.07, BORDER + 0.06, z, 0.14, 0.03, 0.08, leaf);
      p.box(x, BORDER + 0.27, z, 0.13, 0.1, 0.13, head);
    });
  },
};
