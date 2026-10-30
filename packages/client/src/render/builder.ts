// Сборщик процедурной геометрии: коробки и двускатные крыши с вершинными цветами
// складываются в один буфер, из которого получается один меш на всю карту.

import * as THREE from 'three';
import type { Model } from './models';
import type { LightAnchor, LightKind } from './nightPlan';

export class GeoBuilder {
  /** Огни участка: собираются вместе с геометрией и ночью становятся слоем света. */
  readonly lights: LightAnchor[] = [];
  private pos: number[] = [];
  private nrm: number[] = [];
  private col: number[] = [];
  private c = new THREE.Color();

  /** Якорь огня в мировых координатах: центр, поворот фасада, цвет и размер. */
  light(kind: LightKind, x: number, y: number, z: number, rot: number, seed: number, color: number, w: number, h: number, level = 0) {
    this.lights.push({ kind, x, y, z, rot, seed, color, w, h, level });
  }

  // aoBelow/ao: вершины не выше aoBelow затемняются множителем ao - тень у земли
  private tri(a: THREE.Vector3, b: THREE.Vector3, d: THREE.Vector3, color: number, aoBelow = -Infinity, ao = 1) {
    const n = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(d, a)).normalize();
    this.c.setHex(color);
    for (const p of [a, b, d]) {
      const f = p.y <= aoBelow ? ao : 1;
      this.pos.push(p.x, p.y, p.z);
      this.nrm.push(n.x, n.y, n.z);
      this.col.push(this.c.r * f, this.c.g * f, this.c.b * f);
    }
  }

  private quad(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3, color: number, aoBelow = -Infinity, ao = 1) {
    this.tri(a, b, c, color, aoBelow, ao);
    this.tri(a, c, d, color, aoBelow, ao);
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
    // Низкие плиты (земля, дорога, площадки) без затенения, иначе темнеют швы между клетками
    const ao = sy > 0.1 && y0 >= 0 ? 0.7 : 1;
    this.quad(p[4], p[7], p[6], p[5], topColor); // верх
    this.quad(p[3], p[2], p[6], p[7], color, y0, ao); // +z
    this.quad(p[1], p[0], p[4], p[5], color, y0, ao); // -z
    this.quad(p[2], p[1], p[5], p[6], color, y0, ao); // +x
    this.quad(p[0], p[3], p[7], p[4], color, y0, ao); // -x
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

  /**
   * Цилиндр (или усечённый конус при r1 != r0) вдоль локальной +y от основания, преобразованный матрицей m:
   * сдвиг, поворот, наклон. Грани плоские - в стиле остальной геометрии.
   */
  cylinder(m: THREE.Matrix4, r0: number, h: number, color: number, seg = 10, topColor = color, r1 = r0) {
    const ring = (r: number, y: number) => Array.from({ length: seg }, (_, i) => {
      const a = (i / seg) * Math.PI * 2;
      return new THREE.Vector3(Math.cos(a) * r, y, Math.sin(a) * r).applyMatrix4(m);
    });
    const lo = ring(r0, 0), hi = ring(r1, h);
    const top = new THREE.Vector3(0, h, 0).applyMatrix4(m);
    for (let i = 0; i < seg; i++) {
      const j = (i + 1) % seg;
      this.quad(lo[j], lo[i], hi[i], hi[j], color);
      if (r1 > 0) this.tri(hi[j], hi[i], top, topColor);
    }
  }

  /** Коробка вдоль локальной +y от центра основания, преобразованная матрицей m (наклонные стволы, пусковые). */
  boxM(m: THREE.Matrix4, sx: number, sy: number, sz: number, color: number, topColor = color) {
    const hx = sx / 2, hz = sz / 2;
    const v = (dx: number, dy: number, dz: number) => new THREE.Vector3(dx, dy, dz).applyMatrix4(m);
    const p = [
      v(-hx, 0, -hz), v(hx, 0, -hz), v(hx, 0, hz), v(-hx, 0, hz),
      v(-hx, sy, -hz), v(hx, sy, -hz), v(hx, sy, hz), v(-hx, sy, hz),
    ];
    this.quad(p[4], p[7], p[6], p[5], topColor);
    this.quad(p[3], p[2], p[6], p[7], color);
    this.quad(p[1], p[0], p[4], p[5], color);
    this.quad(p[2], p[1], p[5], p[6], color);
    this.quad(p[0], p[3], p[7], p[4], color);
    this.quad(p[0], p[1], p[2], p[3], color);
  }

  /**
   * Плита-призма по многоугольнику в плане: точки (x, z) в мировых координатах, обход любой,
   * многоугольник может быть вогнутым (тротуар со скруглённым углом). Без дна.
   */
  prism(pts: [number, number][], y0: number, h: number, color: number, topColor = color) {
    let area = 0;
    for (let i = 0; i < pts.length; i++) {
      const [ax, az] = pts[i], [bx, bz] = pts[(i + 1) % pts.length];
      area += ax * bz - bx * az;
    }
    // Обход против часовой в (x, z): внешняя нормаль ребра (dx, dz) - (dz, -dx)
    const ring = area > 0 ? pts : [...pts].reverse();
    const top = ring.map(([x, z]) => new THREE.Vector3(x, y0 + h, z));
    const faces = THREE.ShapeUtils.triangulateShape(ring.map(([x, z]) => new THREE.Vector2(x, z)), []);
    for (const [a, b, c] of faces) {
      // Верх смотрит вверх: порядок вершин по знаку площади треугольника
      const up = (top[c].x - top[a].x) * (top[b].z - top[a].z) - (top[b].x - top[a].x) * (top[c].z - top[a].z) > 0;
      if (up) this.tri(top[a], top[b], top[c], topColor);
      else this.tri(top[a], top[c], top[b], topColor);
    }
    for (let i = 0; i < ring.length; i++) {
      const j = (i + 1) % ring.length;
      const [ax, az] = ring[i], [bx, bz] = ring[j];
      this.quad(new THREE.Vector3(bx, y0, bz), new THREE.Vector3(ax, y0, az), top[i], top[j], color);
    }
  }

  /** Готовая модель: точка привязки (x, y0, z), масштаб, поворот вокруг Y - как у box. */
  model(m: Model, x: number, y0: number, z: number, scale: number, rot = 0) {
    const cos = Math.cos(rot), sin = Math.sin(rot);
    const { pos, nrm, col } = m;
    for (let i = 0; i < pos.length; i += 3) {
      const dx = pos[i] * scale, dz = pos[i + 2] * scale;
      this.pos.push(x + dx * cos - dz * sin, y0 + pos[i + 1] * scale, z + dx * sin + dz * cos);
      this.nrm.push(nrm[i] * cos - nrm[i + 2] * sin, nrm[i + 1], nrm[i] * sin + nrm[i + 2] * cos);
      this.col.push(col[i], col[i + 1], col[i + 2]);
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
