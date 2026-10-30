// Урна двора - железный бак с крышкой (README.md: метры, опора на земле, фасад к +z).
// Варианты: 4 цвета PALETTE.bin x (круглая | квадратная).

import * as THREE from 'three';
import { PALETTE, pick } from '../palette';
import type { PropDef } from './kit';

const SIZE = 0.45;
const BASE = 0.04;
const BODY = 0.56;
const TOP = BASE + BODY;

export const TRASH_BIN: PropDef = {
  id: 'trashBin',
  name: 'Урна',
  variants: 4,
  build(p, v) {
    const paint = pick(PALETTE.bin, v);
    const lid = new THREE.Color(paint).multiplyScalar(0.8).getHex();
    const round = v % 2 === 0;
    const r = SIZE / 2;
    // Поддон: бак не стоит на земле, под ним чугунная лапа
    p.box(0, 0, 0, 0.34, BASE, 0.34, PALETTE.iron);
    if (round) {
      p.cylinder(0, BASE, 0, r - 0.005, BODY, paint, 'y', 10);
      p.cylinder(0, TOP, 0, r + 0.015, 0.04, lid, 'y', 10);
      p.cylinder(0, TOP + 0.04, 0, r + 0.02, 0.04, lid, 'y', 10);
      p.cylinder(0, TOP + 0.08, 0, r - 0.05, 0.04, lid, 'y', 10);
      p.cylinder(0, TOP + 0.12, 0, 0.03, 0.03, PALETTE.iron, 'y', 6);
      // Круглое отверстие для мусора спереди
      p.cylinder(0, 0.47, r - 0.01, 0.09, 0.04, PALETTE.iron, 'z', 8);
    } else {
      p.box(0, BASE, 0, SIZE, BODY, SIZE, paint);
      p.box(0, TOP, 0, SIZE + 0.03, 0.04, SIZE + 0.03, lid);
      p.box(0, TOP + 0.04, 0, SIZE + 0.04, 0.04, SIZE + 0.04, lid);
      p.box(0, TOP + 0.08, 0, SIZE - 0.1, 0.04, SIZE - 0.1, lid);
      p.box(0, TOP + 0.12, 0, 0.06, 0.03, 0.06, PALETTE.iron);
      // Рёбра жёсткости на боках
      for (const x of [-0.15, 0.15]) p.box(x, BASE + 0.05, 0, 0.02, BODY - 0.1, SIZE + 0.01, lid);
      // Прямоугольная прорезь для мусора спереди
      p.box(0, 0.4, r - 0.01, 0.26, 0.14, 0.04, PALETTE.iron);
    }
  },
};
