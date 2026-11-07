import * as THREE from 'three';
import type { GeoBuilder } from '../builder';
import { houseKit, type Frame } from '../buildings/parts';

/** Небольшой трактор со складской площадки, капотом к дороге (+f). */
export function farmTractor(g: GeoBuilder, o: Frame, u: number, f: number) {
  const { box, cyl } = houseKit(g, o, u, f, 0.006);
  for (const axle of [{ f: -0.077, r: 0.055, tread: 0.033 }, { f: 0.077, r: 0.031, tread: 0.024 }]) {
    for (const side of [-1, 1]) {
      const inner = 0.066 - axle.tread / 2;
      const [x, z] = o.at(u + side * inner, f + axle.f);
      const wheel = new THREE.Matrix4().makeRotationY(-o.rot)
        .multiply(new THREE.Matrix4().makeRotationZ(-side * Math.PI / 2))
        .setPosition(x, 0.006 + axle.r, z);
      g.cylinder(wheel, axle.r, axle.tread, 0x393630, 10);
      const [hx, hz] = o.at(u + side * (inner + axle.tread), f + axle.f);
      wheel.setPosition(hx, 0.006 + axle.r, hz);
      g.cylinder(wheel, axle.r * 0.52, 0.003, 0xc9a45d, 8);
    }
  }
  const paint = 0x52723d, hood = 0x6c934d, glass = 0x47616a;
  box(0, 0.043, 0, 0.106, 0.029, 0.25, 0x4b453a);
  box(0, 0.072, 0.067, 0.102, 0.049, 0.118, paint, hood);
  box(0, 0.074, 0.127, 0.073, 0.033, 0.005, 0x33322e);
  box(0, 0.072, -0.048, 0.101, 0.096, 0.102, paint);
  box(0, 0.113, -0.048, 0.104, 0.05, 0.105, glass);
  box(0, 0.163, -0.048, 0.12, 0.013, 0.119, 0xdecaa1);
  for (const s of [-1, 1]) {
    box(s * 0.064, 0.108, -0.077, 0.044, 0.014, 0.119, hood);
    box(s * 0.036, 0.1, 0.129, 0.017, 0.015, 0.005, 0xf4dfa6);
  }
  cyl(-0.033, 0.085, 0.116, 0.007, 0.06, 0x514d43, 6);
}
