// Мусорный контейнер двора (металлический, на колёсиках) - образец предмета для render/props/ (README.md).
// Варианты: 4 цвета x (крышка закрыта | откинута, видны мешки).

import * as THREE from 'three';
import { PALETTE, pick } from '../palette';
import type { PropDef } from './kit';

const W = 1.3;
const D = 0.95;
const WHEEL = 0.14;
const H = 1.0;

export const DUMPSTER: PropDef = {
  id: 'dumpster',
  name: 'Мусорный контейнер',
  variants: 8,
  build(p, v) {
    const paint = pick(PALETTE.bin, v);
    const lid = new THREE.Color(paint).multiplyScalar(0.8).getHex();
    const open = v >= 4;
    // Колёсики по углам
    for (const x of [-W / 2 + 0.12, W / 2 - 0.12]) {
      for (const z of [-D / 2 + 0.12, D / 2 - 0.12]) p.cylinder(x - 0.03, WHEEL / 2, z, WHEEL / 2, 0.06, PALETTE.tire, 'x', 8);
    }
    // Бак: коробка с поясом жёсткости и ободом
    p.box(0, WHEEL, 0, W, H - WHEEL, D, paint);
    p.box(0, WHEEL + 0.32, 0, W + 0.04, 0.06, D + 0.04, lid);
    p.box(0, H - 0.06, 0, W + 0.06, 0.06, D + 0.06, lid);
    // Цапфы для мусоровоза по бокам
    for (const x of [-W / 2 - 0.05, W / 2 + 0.05]) p.cylinder(x - 0.04, H * 0.62, 0, 0.05, 0.08, PALETTE.iron, 'x', 8);
    if (!open) {
      p.box(0, H, 0, W + 0.02, 0.05, D + 0.02, lid);
      p.box(0, H + 0.05, D / 2 - 0.08, 0.5, 0.03, 0.06, PALETTE.iron); // ручка крышки
      return;
    }
    // Мешки торчат из открытого бака, крышка откинута назад на петлях
    p.box(-0.25, H - 0.12, 0.05, 0.5, 0.26, 0.45, pick(PALETTE.trashBag, v));
    p.box(0.28, H - 0.12, -0.1, 0.45, 0.2, 0.4, pick(PALETTE.trashBag, v + 1));
    const hinge = new THREE.Matrix4().makeTranslation(0, H, -D / 2 - 0.01).multiply(new THREE.Matrix4().makeRotationX(-0.25));
    p.boxAt(hinge, W + 0.02, D * 0.9, 0.05, lid);
  },
};
