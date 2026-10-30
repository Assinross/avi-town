// Фургон - образец машины для render/props/vehicles/ (README.md): размеры в метрах как у настоящего,
// на улице уменьшается VEHICLE_SCALE. Капот к +z, колёса стоят на земле (y = 0).
// Варианты: 6 цветов кузова, у каждого третьего - полоса службы доставки.

import * as THREE from 'three';
import { PALETTE, pick } from '../../palette';
import { VEHICLE_SCALE, type PropDef } from '../kit';

const W = 1.96;
const BODY_Y = 0.32;
const ROOF = 2.2;
const REAR = -2.45;
/** Где кончается высокий кузов и начинается капот. */
const CAB = 1.45;
const NOSE = 2.45;
const HOOD = 1.05;
/** Лобовое стекло ложится на капот на такую длину. */
const SCREEN = 0.55;
const WHEEL_R = 0.36;
const WHEEL_W = 0.26;

export const VAN: PropDef = {
  id: 'van',
  name: 'Фургон',
  variants: 6,
  scale: VEHICLE_SCALE,
  build(p, v) {
    const paint = pick(PALETTE.vehicle, v);
    const roof = new THREE.Color(paint).multiplyScalar(1.08).getHex();
    const side = W / 2 + 0.005;
    // Колёса с колпаками и тёмные арки над ними
    for (const z of [-1.55, 1.6]) {
      for (const s of [-1, 1]) {
        p.cylinder(s < 0 ? -W / 2 - 0.02 : W / 2 - WHEEL_W + 0.02, WHEEL_R, z, WHEEL_R, WHEEL_W, PALETTE.tire, 'x', 12);
        p.cylinder(s < 0 ? -W / 2 - 0.04 : W / 2 + 0.02, WHEEL_R, z, 0.16, 0.02, pick(PALETTE.metal, 0), 'x', 8);
        p.box(s * side, BODY_Y, z, 0.02, 0.48, 0.92, PALETTE.tire);
      }
    }
    // Кузов: высокая будка с кабиной, капот, наклонное лобовое стекло
    p.box(0, BODY_Y, (REAR + CAB) / 2, W, ROOF - BODY_Y, CAB - REAR, paint, roof);
    p.box(0, BODY_Y, (CAB + NOSE) / 2, W - 0.04, HOOD - BODY_Y, NOSE - CAB, paint);
    p.wedge(0, HOOD, CAB + SCREEN / 2, W - 0.06, ROOF - 0.05 - HOOD, SCREEN, paint, PALETTE.glassDark);
    // Бамперы
    p.box(0, 0.28, NOSE + 0.05, W + 0.02, 0.22, 0.12, PALETTE.iron);
    p.box(0, 0.28, REAR - 0.05, W + 0.02, 0.22, 0.12, PALETTE.iron);
    // Морда: решётка и фары; зад: стопы, стёкла и шов распашных дверей
    p.box(0, 0.55, NOSE + 0.01, 0.9, 0.32, 0.04, PALETTE.iron);
    for (const s of [-1, 1]) {
      p.box(s * 0.72, 0.68, NOSE + 0.01, 0.3, 0.16, 0.04, PALETTE.headlight);
      p.box(s * 0.86, 0.95, REAR - 0.01, 0.14, 0.4, 0.04, PALETTE.taillight);
      p.box(s * 0.46, 1.5, REAR - 0.01, 0.7, 0.45, 0.04, PALETTE.glassDark);
      // Боковое стекло кабины, зеркало, шов сдвижной двери
      p.box(s * side, 1.3, CAB - 0.4, 0.02, 0.6, 0.7, PALETTE.glassDark);
      p.box(s * (W / 2 + 0.08), 1.4, CAB + 0.05, 0.14, 0.2, 0.08, PALETTE.iron);
      p.box(s * side, 0.42, 0.55, 0.02, 1.65, 0.03, PALETTE.iron);
      if (v % 3 === 0) p.box(s * side, 0.95, -0.95, 0.02, 0.22, 2.6, pick(PALETTE.signs, v / 3));
    }
    p.box(0, 0.4, REAR - 0.01, 0.03, 1.72, 0.04, PALETTE.iron);
  },
};
