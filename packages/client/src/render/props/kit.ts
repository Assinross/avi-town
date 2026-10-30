// Шаблон предметов (plan.md, этап 0): скамейки, контейнеры, машины и прочие мелочи улиц и дворов.
// Предмет описывается в метрах от точки опоры, собирается в буфер с вершинными цветами и дальше
// либо вклеивается в геометрию участка (placeProp), либо рисуется пачкой (propMesh). Правила - README.md.

import * as THREE from 'three';
import type { GeoBuilder } from '../builder';
import type { Model } from '../models';

/** Метр в единицах мира: клетка = 1 единица ~ 10 м. */
export const M = 0.1;
/**
 * Машины пока мельче жизни: легковые KayKit на улицах ~0.25 клетки, полоса нынешней дороги узкая.
 * Окончательный масштаб решит этап 3 (полосы на графе улиц) - меняется здесь одним числом.
 */
export const VEHICLE_SCALE = 0.5;

export interface PropDef {
  id: string;
  /** Название по-русски - подпись на странице ?props. */
  name: string;
  /** Сколько разных вариантов; номер варианта приводится к 0..variants-1. */
  variants: number;
  /** Множитель к метрам: 1 - натуральная величина, VEHICLE_SCALE - машины. */
  scale?: number;
  /** Рисует предмет в метрах: опора - (0, 0, 0) на земле в центре, фасад к +z. */
  build(p: PropBuilder, variant: number): void;
}

/** Вершины не выше этого (в метрах) - у самой земли: затемняются, предмет "стоит", а не висит. */
const GROUND_AO_Y = 0.05;
const GROUND_AO = 0.78;

/**
 * Сборщик предмета в метрах. Все детали замкнутые (с дном): тени three.js рисуются задними гранями,
 * и деталь без дна отбрасывает тень с дырами.
 */
export class PropBuilder {
  private pos: number[] = [];
  private nrm: number[] = [];
  private col: number[] = [];
  private c = new THREE.Color();
  private n = new THREE.Vector3();
  private e1 = new THREE.Vector3();
  private e2 = new THREE.Vector3();

  private tri(a: THREE.Vector3, b: THREE.Vector3, d: THREE.Vector3, color: number) {
    this.n.crossVectors(this.e1.subVectors(b, a), this.e2.subVectors(d, a)).normalize();
    this.c.setHex(color);
    for (const p of [a, b, d]) {
      const f = p.y <= GROUND_AO_Y ? GROUND_AO : 1;
      this.pos.push(p.x, p.y, p.z);
      this.nrm.push(this.n.x, this.n.y, this.n.z);
      this.col.push(this.c.r * f, this.c.g * f, this.c.b * f);
    }
  }

  private quad(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3, color: number) {
    this.tri(a, b, c, color);
    this.tri(a, c, d, color);
  }

  /** Коробка: центр основания (x, y0, z), размеры по осям; topColor - верхняя грань. */
  box(x: number, y0: number, z: number, sx: number, sy: number, sz: number, color: number, topColor = color) {
    this.boxAt(new THREE.Matrix4().makeTranslation(x, y0, z), sx, sy, sz, color, topColor);
  }

  /** Коробка вдоль локальной +y от центра основания, преобразованная матрицей m: наклон, поворот. */
  boxAt(m: THREE.Matrix4, sx: number, sy: number, sz: number, color: number, topColor = color) {
    const hx = sx / 2, hz = sz / 2;
    const v = (dx: number, dy: number, dz: number) => new THREE.Vector3(dx, dy, dz).applyMatrix4(m);
    const p = [
      v(-hx, 0, -hz), v(hx, 0, -hz), v(hx, 0, hz), v(-hx, 0, hz),
      v(-hx, sy, -hz), v(hx, sy, -hz), v(hx, sy, hz), v(-hx, sy, hz),
    ];
    this.quad(p[4], p[7], p[6], p[5], topColor); // верх
    this.quad(p[0], p[1], p[2], p[3], color); // низ
    this.quad(p[3], p[2], p[6], p[7], color); // +z
    this.quad(p[1], p[0], p[4], p[5], color); // -z
    this.quad(p[2], p[1], p[5], p[6], color); // +x
    this.quad(p[0], p[3], p[7], p[4], color); // -x
  }

  /**
   * Клин: в профиле прямоугольный треугольник - высокая стенка сзади (-z), скат вниз к +z.
   * Лобовое стекло, капот, пандус. slopeColor - скат, остальное - color.
   */
  wedge(x: number, y0: number, z: number, sx: number, sy: number, sz: number, color: number, slopeColor = color) {
    const hx = sx / 2, hz = sz / 2;
    const v = (dx: number, dy: number, dz: number) => new THREE.Vector3(x + dx, y0 + dy, z + dz);
    const lb = v(-hx, 0, -hz), rb = v(hx, 0, -hz), lf = v(-hx, 0, hz), rf = v(hx, 0, hz);
    const lt = v(-hx, sy, -hz), rt = v(hx, sy, -hz);
    this.quad(lb, rb, rf, lf, color); // низ
    this.quad(rb, lb, lt, rt, color); // задняя стенка
    this.quad(lf, rf, rt, lt, slopeColor); // скат
    this.tri(rf, rb, rt, color); // бок +x
    this.tri(lb, lf, lt, color); // бок -x
  }

  /** Цилиндр с крышками вдоль оси axis: центр основания (x, y0, z), длина h, грани плоские. */
  cylinder(x: number, y0: number, z: number, r: number, h: number, color: number, axis: 'x' | 'y' | 'z' = 'y', seg = 10, capColor = color) {
    const m = new THREE.Matrix4();
    if (axis === 'x') m.makeRotationZ(-Math.PI / 2);
    else if (axis === 'z') m.makeRotationX(Math.PI / 2);
    m.setPosition(x, y0, z);
    const ring = (y: number) => Array.from({ length: seg }, (_, i) => {
      const a = (i / seg) * Math.PI * 2;
      return new THREE.Vector3(Math.cos(a) * r, y, Math.sin(a) * r).applyMatrix4(m);
    });
    const lo = ring(0), hi = ring(h);
    const top = new THREE.Vector3(0, h, 0).applyMatrix4(m), bottom = new THREE.Vector3(0, 0, 0).applyMatrix4(m);
    for (let i = 0; i < seg; i++) {
      const j = (i + 1) % seg;
      this.quad(lo[j], lo[i], hi[i], hi[j], color);
      this.tri(hi[j], hi[i], top, capColor);
      this.tri(lo[i], lo[j], bottom, capColor);
    }
  }

  model(): Model {
    return { pos: new Float32Array(this.pos), nrm: new Float32Array(this.nrm), col: new Float32Array(this.col) };
  }
}

const models = new Map<string, Model>();

/** Предмет в метрах (кэш по варианту): для своих сборщиков и склейки. */
export function propModel(def: PropDef, variant: number): Model {
  const v = ((Math.floor(variant) % def.variants) + def.variants) % def.variants;
  const key = `${def.id}:${v}`;
  let m = models.get(key);
  if (!m) {
    const p = new PropBuilder();
    def.build(p, v);
    m = p.model();
    models.set(key, m);
  }
  return m;
}

/** Масштаб предмета в единицах мира: метры * множитель вида. */
export const propScale = (def: PropDef) => M * (def.scale ?? 1);

/**
 * Вклеить предмет в геометрию участка: опора в (x, y0, z) мира, поворот rot - как у GeoBuilder.box
 * (rot = 0 - фасад к +z). Так предметы дворов и улиц попадают в один меш с тенями и контуром.
 */
export function placeProp(g: GeoBuilder, def: PropDef, variant: number, x: number, y0: number, z: number, rot = 0) {
  g.model(propModel(def, variant), x, y0, z, propScale(def), rot);
}

/** Геометрия предмета в единицах мира - для InstancedMesh (машины, массовые мелочи). */
export function propGeometry(def: PropDef, variant: number): THREE.BufferGeometry {
  const { pos, nrm, col } = propModel(def, variant);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  const s = propScale(def);
  return g.scale(s, s, s);
}

/** Пачка одинаковых предметов: тени отбрасывает и принимает, матрицы экземпляров - снаружи. */
export function propMesh(def: PropDef, variant: number, count: number, material: THREE.Material): THREE.InstancedMesh {
  const m = new THREE.InstancedMesh(propGeometry(def, variant), material, count);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}
