// Сарай двора: дощатые стены, односкатная крыша из ржавого железа, дверь на фасад (+z).
// Варианты: 4 - доски PALETTE.planks x крыша PALETTE.roofRust, дверь закрыта/приоткрыта.

import * as THREE from 'three';
import { PALETTE, pick } from '../palette';
import type { PropDef } from './kit';

const W = 2.5;
const D = 2.0;
const WALL_H = 1.85;
const RISE = 0.45;
const ANGLE = Math.atan2(RISE, D);
const ROOF_LEN = Math.hypot(D, RISE) + 0.3;
const DOOR_W = 0.9;
const DOOR_H = 1.75;
const DOOR_X = 0.35;

export const SHED: PropDef = {
  id: 'shed',
  name: 'Сарай',
  variants: 4,
  build(p, v) {
    const wood = pick(PALETTE.planks, v);
    const woodDark = new THREE.Color(wood).multiplyScalar(0.82).getHex();
    const roof = pick(PALETTE.roofRust, v);
    const roofDark = new THREE.Color(roof).multiplyScalar(0.8).getHex();
    const ajar = v % 2 === 1;
    // Стены и фронтон-клин под односкатную крышу: высокая стенка сзади, скат к фасаду
    p.box(0, 0, 0, W, WALL_H, D, wood);
    p.wedge(0, WALL_H, 0, W, RISE, D, woodDark, roof);
    // Угловые стойки и швы досок на фасаде
    for (const x of [-W / 2 + 0.06, W / 2 - 0.06]) {
      for (const z of [-D / 2 + 0.06, D / 2 - 0.06]) p.box(x, 0, z, 0.12, WALL_H, 0.12, woodDark);
    }
    for (const x of [-0.95, -0.45, 0.95]) p.box(x, 0.05, D / 2 + 0.005, 0.02, WALL_H - 0.1, 0.02, woodDark);
    // Крыша: плита по скату с напуском и рёбра
    const slope = new THREE.Matrix4().makeRotationX(ANGLE).setPosition(0, WALL_H + RISE / 2, 0);
    p.boxAt(slope, W + 0.3, 0.06, ROOF_LEN, roof, roofDark);
    for (const x of [-0.9, 0, 0.9]) {
      p.boxAt(slope.clone().multiply(new THREE.Matrix4().makeTranslation(x, 0.06, 0)), 0.08, 0.02, ROOF_LEN, roofDark);
    }
    // Дверная коробка
    p.box(DOOR_X - DOOR_W / 2 - 0.03, 0, D / 2 + 0.02, 0.06, DOOR_H + 0.06, 0.06, woodDark);
    p.box(DOOR_X + DOOR_W / 2 + 0.03, 0, D / 2 + 0.02, 0.06, DOOR_H + 0.06, 0.06, woodDark);
    p.box(DOOR_X, DOOR_H + 0.03, D / 2 + 0.02, DOOR_W + 0.12, 0.06, 0.06, woodDark);
    // Дверь: закрытая в проёме или приоткрытая на петлях наружу
    if (!ajar) {
      p.box(DOOR_X, 0, D / 2 + 0.01, DOOR_W, DOOR_H, 0.05, PALETTE.door);
      for (const y of [0.3, 1.35]) p.box(DOOR_X, y, D / 2 + 0.04, DOOR_W - 0.06, 0.08, 0.02, woodDark);
      p.box(DOOR_X + DOOR_W / 2 - 0.12, 0.9, D / 2 + 0.05, 0.05, 0.12, 0.04, PALETTE.iron);
    } else {
      const hinge = new THREE.Matrix4()
        .makeTranslation(DOOR_X - DOOR_W / 2, 0, D / 2 + 0.01)
        .multiply(new THREE.Matrix4().makeRotationY(-0.45))
        .multiply(new THREE.Matrix4().makeTranslation(DOOR_W / 2, 0, 0));
      p.boxAt(hinge, DOOR_W, DOOR_H, 0.05, PALETTE.door);
      for (const y of [0.3, 1.35]) {
        p.boxAt(hinge.clone().multiply(new THREE.Matrix4().makeTranslation(0, y, 0.04)), DOOR_W - 0.06, 0.08, 0.02, woodDark);
      }
      p.boxAt(hinge.clone().multiply(new THREE.Matrix4().makeTranslation(DOOR_W / 2 - 0.12, 0.9, 0.05)), 0.05, 0.12, 0.04, PALETTE.iron);
    }
    // Окошко слева от двери
    p.box(-0.75, 1.05, D / 2 + 0.01, 0.5, 0.45, 0.04, PALETTE.glassDark);
    p.box(-0.75, 1.5, D / 2 + 0.02, 0.56, 0.05, 0.05, PALETTE.iron);
    p.box(-0.75, 1.02, D / 2 + 0.02, 0.56, 0.05, 0.05, PALETTE.iron);
    for (const x of [-1.0, -0.5]) p.box(x, 1.02, D / 2 + 0.02, 0.05, 0.5, 0.05, PALETTE.iron);
  },
};
