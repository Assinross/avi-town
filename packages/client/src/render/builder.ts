// Сборщик процедурной геометрии: коробки и двускатные крыши с вершинными цветами
// складываются в один буфер, из которого получается один меш на всю карту.

import * as THREE from 'three';

export class GeoBuilder {
  private pos: number[] = [];
  private nrm: number[] = [];
  private col: number[] = [];
  private c = new THREE.Color();

  private tri(a: THREE.Vector3, b: THREE.Vector3, d: THREE.Vector3, color: number) {
    const n = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(d, a)).normalize();
    this.c.setHex(color);
    for (const p of [a, b, d]) {
      this.pos.push(p.x, p.y, p.z);
      this.nrm.push(n.x, n.y, n.z);
      this.col.push(this.c.r, this.c.g, this.c.b);
    }
  }

  private quad(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3, color: number) {
    this.tri(a, b, c, color);
    this.tri(a, c, d, color);
  }

  /** Коробка: центр основания (x, y0, z), размеры, поворот вокруг Y в радианах. */
  box(x: number, y0: number, z: number, sx: number, sy: number, sz: number, color: number, rot = 0, topColor = color) {
    const hx = sx / 2, hz = sz / 2;
    const cos = Math.cos(rot), sin = Math.sin(rot);
    const v = (dx: number, dy: number, dz: number) =>
      new THREE.Vector3(x + dx * cos - dz * sin, y0 + dy, z + dx * sin + dz * cos);
    const p = [
      v(-hx, 0, -hz), v(hx, 0, -hz), v(hx, 0, hz), v(-hx, 0, hz),
      v(-hx, sy, -hz), v(hx, sy, -hz), v(hx, sy, hz), v(-hx, sy, hz),
    ];
    this.quad(p[4], p[7], p[6], p[5], topColor); // верх
    this.quad(p[3], p[2], p[6], p[7], color); // +z
    this.quad(p[1], p[0], p[4], p[5], color); // -z
    this.quad(p[2], p[1], p[5], p[6], color); // +x
    this.quad(p[0], p[3], p[7], p[4], color); // -x
  }

  /** Двускатная крыша; конёк вдоль X, либо вдоль Z при alongZ. sx, sz - размеры по осям мира. */
  gable(x: number, y0: number, z: number, sx: number, h: number, sz: number, color: number, gableColor: number, alongZ = false) {
    const hx = sx / 2, hz = sz / 2;
    const v = (dx: number, dy: number, dz: number) => new THREE.Vector3(x + dx, y0 + dy, z + dz);
    if (!alongZ) {
      const a = v(-hx, 0, hz), b = v(hx, 0, hz), c = v(hx, 0, -hz), d = v(-hx, 0, -hz);
      const r1 = v(-hx, h, 0), r2 = v(hx, h, 0);
      this.quad(a, b, r2, r1, color);
      this.quad(c, d, r1, r2, color);
      this.tri(b, c, r2, gableColor);
      this.tri(d, a, r1, gableColor);
    } else {
      const a = v(hx, 0, hz), b = v(hx, 0, -hz), c = v(-hx, 0, -hz), d = v(-hx, 0, hz);
      const r1 = v(0, h, hz), r2 = v(0, h, -hz);
      this.quad(a, b, r2, r1, color);
      this.quad(c, d, r1, r2, color);
      this.tri(b, c, r2, gableColor);
      this.tri(d, a, r1, gableColor);
    }
  }

  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    return g;
  }
}
