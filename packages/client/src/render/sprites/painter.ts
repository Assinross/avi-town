// Код-художник спрайтов (прототип 009, specs/009-painted-sprites/style-bible.md).
// Форму задаёт простая болванка (коробки, цилиндры, эллипсоиды, холмы) в изометрии камеры игры:
// она даёт силуэт, свет и глубину каждого пикселя. Поверх неё кладутся мазки кисти цветом
// освещённой болванки - так художники пишут спрайты поверх 3D-заготовок. Результат - плоский
// прозрачный рисунок и карта глубины к нему (насколько пиксель ближе к камере, чем точка привязки).
// Свет привязан к экрану: слева сверху и чуть спереди при любом повороте камеры.

export type Vec3 = [number, number, number];
/** Цвет 0..1 в sRGB. */
export type RGB = [number, number, number];

export const hex = (c: number): RGB => [((c >> 16) & 255) / 255, ((c >> 8) & 255) / 255, (c & 255) / 255];
const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
export const mix = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const mul = (a: RGB, k: number | RGB): RGB => typeof k === 'number' ? [a[0] * k, a[1] * k, a[2] * k] : [a[0] * k[0], a[1] * k[1], a[2] * k[2]];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (a: Vec3): Vec3 => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];

/** Детерминированный генератор 0..1: одна и та же картинка при каждом запуске. */
export function rng(seed: number): () => number {
  let s = (seed * 2654435761) >>> 0 || 1;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const hash3 = (x: number, y: number, z: number) => {
  const s = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453;
  return s - Math.floor(s);
};

/** Плавный шум 0..1 - пятна на бетоне, переливы травы. */
export function noise3(x: number, y: number, z: number): number {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const fx = x - xi, fy = y - yi, fz = z - zi;
  const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy), w = fz * fz * (3 - 2 * fz);
  const l = (a: number, b: number, t: number) => a + (b - a) * t;
  return l(
    l(l(hash3(xi, yi, zi), hash3(xi + 1, yi, zi), u), l(hash3(xi, yi + 1, zi), hash3(xi + 1, yi + 1, zi), u), v),
    l(l(hash3(xi, yi, zi + 1), hash3(xi + 1, yi, zi + 1), u), l(hash3(xi, yi + 1, zi + 1), hash3(xi + 1, yi + 1, zi + 1), u), v),
    w,
  );
}

export const fbm = (x: number, y: number, z: number) => noise3(x, y, z) * 0.6 + noise3(x * 2.1, y * 2.1, z * 2.1) * 0.3 + noise3(x * 4.3, y * 4.3, z * 4.3) * 0.1;

/** Наклон камеры игры - классическая изометрия (input/cameraRig.ts). */
const ELEV = Math.atan(1 / Math.SQRT2);
/** Глубина точки земли по экранной высоте: tan(наклона) = 1/sqrt2. */
export const GROUND_DEPTH = -Math.SQRT2;
/** Глубина стоящего вертикально рисунка по экранной высоте. */
export const STANDEE_DEPTH = 1 / Math.SQRT2;

/**
 * Проекция камеры игры при азимуте 45 градусов (вид 0). Остальные повороты камеры - это тот же
 * вид на объект, повёрнутый на четверть оборота, поэтому рисуем всегда в виде 0.
 */
export class IsoView {
  readonly toward: Vec3;
  readonly right: Vec3;
  readonly up: Vec3;
  readonly light: Vec3;

  constructor() {
    const a = Math.PI / 4, ce = Math.cos(ELEV), se = Math.sin(ELEV);
    this.toward = [Math.cos(a) * ce, se, Math.sin(a) * ce];
    this.right = norm([this.toward[2], 0, -this.toward[0]]);
    this.up = cross(this.toward, this.right);
    // Солнце слева сверху и чуть спереди - для экрана, а не для мира
    const th: Vec3 = [Math.cos(a), 0, Math.sin(a)];
    this.light = norm([-0.55 * this.right[0] + 0.35 * th[0], 0.8, -0.55 * this.right[2] + 0.35 * th[2]]);
  }
}
export const VIEW = new IsoView();

/** Материал: три тона (свет, основа, тень), направление мазка и мелкая фактура. */
export interface Material {
  base: RGB;
  light: RGB;
  shadow: RGB;
  /** along - вдоль стены, up - снизу вверх (трава), dab - пятнами, vertical - потёки и блики металла. */
  grain: 'along' | 'up' | 'dab' | 'vertical';
  /** Размер мазка относительно обычного. */
  stroke: number;
  /** Сила пятен цвета (крупный шум). */
  mottle: number;
  /** Разброс тона мазков. */
  jitter: number;
  /** Редкие вкрапления (цветы в траве, ржавчина на металле) и их доля. */
  speck?: RGB;
  speckRate?: number;
  /** Свечение без света (визор, лампа): тон не зависит от солнца. */
  flat?: boolean;
  /** Пятна другого цвета по крупному шуму (проплешины земли на насыпи) и их доля 0..1. */
  patch?: RGB;
  patchRate?: number;
  /** Вертикальные потёки на стенах (бетон), сила 0..1. */
  streaks?: number;
  /** Ряды черепицы или профнастила: рядов на единицу высоты. */
  rows?: number;
  /**
   * Светится ночью (окна, витрины, лампы). Число - порядок включения 0..1 для всех пикселей
   * (лампы - первыми), true - у каждого окна свой случайный порядок.
   */
  glow?: number | true;
}

/** Материал по трём цветам из Style Bible. */
export function material(light: number, base: number, shadow: number, grain: Material['grain'], opts: Partial<Material> = {}): Material {
  return { light: hex(light), base: hex(base), shadow: hex(shadow), grain, stroke: 1, mottle: 0.12, jitter: 0.07, ...opts };
}

interface Tri {
  p: [Vec3, Vec3, Vec3];
  n: [Vec3, Vec3, Vec3];
  mat: number;
}

/** Болванка: набор треугольников в мире относительно точки привязки (на земле под центром). */
export class Blockout {
  readonly tris: Tri[] = [];
  private stack: { yaw: number; x: number; y: number; z: number }[] = [];
  private t = { yaw: 0, x: 0, y: 0, z: 0 };
  /** Общий масштаб болванки: человек рисуется в размерах 0.2 и растягивается до нужного роста. */
  scale = 1;

  /** Поворот вокруг вертикали (как rotation.y в three.js) и сдвиг для вложенных деталей. */
  push(x: number, y: number, z: number, yaw = 0) {
    this.stack.push({ ...this.t });
    const [wx, wy, wz] = this.apply([x, y, z]);
    this.t = { yaw: this.t.yaw + yaw, x: wx, y: wy, z: wz };
  }

  pop() {
    this.t = this.stack.pop()!;
  }

  private apply(p: Vec3): Vec3 {
    const c = Math.cos(this.t.yaw), s = Math.sin(this.t.yaw), k = this.scale;
    return [(p[0] * c + p[2] * s) * k + this.t.x, p[1] * k + this.t.y, (-p[0] * s + p[2] * c) * k + this.t.z];
  }

  private dir(n: Vec3): Vec3 {
    const c = Math.cos(this.t.yaw), s = Math.sin(this.t.yaw);
    return [n[0] * c + n[2] * s, n[1], -n[0] * s + n[2] * c];
  }

  tri(a: Vec3, b: Vec3, c: Vec3, mat: number, na?: Vec3, nb?: Vec3, nc?: Vec3) {
    const pa = this.apply(a), pb = this.apply(b), pc = this.apply(c);
    if (!na) {
      const n = norm(cross(sub(pb, pa), sub(pc, pa)));
      this.tris.push({ p: [pa, pb, pc], n: [n, n, n], mat });
      return;
    }
    this.tris.push({ p: [pa, pb, pc], n: [norm(this.dir(na)), norm(this.dir(nb!)), norm(this.dir(nc!))], mat });
  }

  quad(a: Vec3, b: Vec3, c: Vec3, d: Vec3, mat: number) {
    this.tri(a, b, c, mat);
    this.tri(a, c, d, mat);
  }

  /**
   * Коробка: центр основания (x, z), низ y. inset - верх уже низа (наклонные стены, как у
   * подпорной стенки бункера); top - другой материал верха.
   */
  box(x: number, y: number, z: number, w: number, h: number, d: number, mat: number, opts: { inset?: number; top?: number } = {}) {
    const i = opts.inset ?? 0;
    const x0 = x - w / 2, x1 = x + w / 2, z0 = z - d / 2, z1 = z + d / 2, y1 = y + h;
    const b: Vec3[] = [[x0, y, z0], [x1, y, z0], [x1, y, z1], [x0, y, z1]];
    const t: Vec3[] = [[x0 + i, y1, z0 + i], [x1 - i, y1, z0 + i], [x1 - i, y1, z1 - i], [x0 + i, y1, z1 - i]];
    this.quad(t[0], t[3], t[2], t[1], opts.top ?? mat);
    for (let k = 0; k < 4; k++) {
      const k1 = (k + 1) % 4;
      this.quad(b[k], b[k1], t[k1], t[k], mat);
    }
  }

  /** Вертикальный цилиндр со сглаженными боками; r1 - радиус верха (конус). */
  cylinder(x: number, y: number, z: number, r: number, h: number, mat: number, seg = 10, r1 = r) {
    for (let k = 0; k < seg; k++) {
      const a0 = (k / seg) * Math.PI * 2, a1 = ((k + 1) / seg) * Math.PI * 2;
      const n0: Vec3 = [Math.cos(a0), (r - r1) / h, Math.sin(a0)], n1: Vec3 = [Math.cos(a1), (r - r1) / h, Math.sin(a1)];
      const b0: Vec3 = [x + Math.cos(a0) * r, y, z + Math.sin(a0) * r], b1: Vec3 = [x + Math.cos(a1) * r, y, z + Math.sin(a1) * r];
      const t0: Vec3 = [x + Math.cos(a0) * r1, y + h, z + Math.sin(a0) * r1], t1: Vec3 = [x + Math.cos(a1) * r1, y + h, z + Math.sin(a1) * r1];
      this.tri(b0, t1, b1, mat, n0, n1, n1);
      this.tri(b0, t0, t1, mat, n0, n0, n1);
      this.tri([x, y + h, z], t1, t0, mat, [0, 1, 0], [0, 1, 0], [0, 1, 0]);
    }
  }

  /** Эллипсоид; bump - бугристость (кроны, мешки), seed - узор бугров. */
  ellipsoid(x: number, y: number, z: number, rx: number, ry: number, rz: number, mat: number, opts: { seg?: number; bump?: number; seed?: number; flatBottom?: boolean } = {}) {
    const seg = opts.seg ?? 10, bump = opts.bump ?? 0, seed = opts.seed ?? 0;
    const pt = (i: number, j: number): [Vec3, Vec3] => {
      const th = (i / seg) * Math.PI * 2, ph = (j / seg) * Math.PI - Math.PI / 2;
      const nx = Math.cos(ph) * Math.cos(th), ny = Math.sin(ph), nz = Math.cos(ph) * Math.sin(th);
      const k = 1 + (noise3(nx * 2.2 + seed, ny * 2.2, nz * 2.2) - 0.5) * 2 * bump;
      const py = opts.flatBottom && ny < 0 ? ny * 0.25 : ny;
      return [[x + nx * rx * k, y + py * ry * k, z + nz * rz * k], [nx / rx, ny / ry, nz / rz]];
    };
    for (let i = 0; i < seg; i++) {
      for (let j = 0; j < seg; j++) {
        const [a, na] = pt(i, j), [b, nb] = pt(i + 1, j), [c, nc] = pt(i + 1, j + 1), [d, nd] = pt(i, j + 1);
        this.tri(a, c, b, mat, na, nc, nb);
        this.tri(a, d, c, mat, na, nd, nc);
      }
    }
  }

  /**
   * Двускатная крыша над прямоугольником w x d: конёк вдоль x (along = 'x') или z, свес over,
   * фронтоны - материалом стены gable.
   */
  gable(x: number, y: number, z: number, w: number, d: number, h: number, roof: number, gable: number, along: 'x' | 'z' = 'x', over = 0.04) {
    this.push(x, y, z, along === 'x' ? 0 : Math.PI / 2);
    const W = (along === 'x' ? w : d) / 2, D = (along === 'x' ? d : w) / 2;
    const e = W + over, f = D + over, sl = (over / D) * h;
    // Скаты: от свеса (чуть ниже карниза) к коньку
    this.quad([-e, -sl, f], [e, -sl, f], [e, h, 0], [-e, h, 0], roof);
    this.quad([e, -sl, -f], [-e, -sl, -f], [-e, h, 0], [e, h, 0], roof);
    this.tri([W, 0, D], [W, 0, -D], [W, h, 0], gable);
    this.tri([-W, 0, -D], [-W, 0, D], [-W, h, 0], gable);
    this.pop();
  }

  /** Вальмовая крыша (четыре ската): конёк короче дома на глубину. */
  hip(x: number, y: number, z: number, w: number, d: number, h: number, roof: number, over = 0.04) {
    const a = w / 2 + over, b = d / 2 + over, r = Math.max(0, a - b);
    const sl = -0.02;
    this.quad([x - a, y + sl, z + b], [a + x, y + sl, b + z], [r + x, y + h, z], [-r + x, y + h, z], roof);
    this.quad([a + x, y + sl, -b + z], [-a + x, y + sl, -b + z], [-r + x, y + h, z], [r + x, y + h, z], roof);
    this.tri([a + x, y + sl, b + z], [a + x, y + sl, -b + z], [r + x, y + h, z], roof);
    this.tri([-a + x, y + sl, -b + z], [-a + x, y + sl, b + z], [-r + x, y + h, z], roof);
  }

  /** Капсула между двумя точками - руки, ноги, ствол дерева. */
  capsule(a: Vec3, b: Vec3, r: number, mat: number, seg = 8) {
    const axis = norm(sub(b, a));
    const side = norm(Math.abs(axis[1]) < 0.9 ? cross(axis, [0, 1, 0]) : cross(axis, [1, 0, 0]));
    const up = cross(side, axis);
    for (let k = 0; k < seg; k++) {
      const a0 = (k / seg) * Math.PI * 2, a1 = ((k + 1) / seg) * Math.PI * 2;
      const n0: Vec3 = [side[0] * Math.cos(a0) + up[0] * Math.sin(a0), side[1] * Math.cos(a0) + up[1] * Math.sin(a0), side[2] * Math.cos(a0) + up[2] * Math.sin(a0)];
      const n1: Vec3 = [side[0] * Math.cos(a1) + up[0] * Math.sin(a1), side[1] * Math.cos(a1) + up[1] * Math.sin(a1), side[2] * Math.cos(a1) + up[2] * Math.sin(a1)];
      const p = (o: Vec3, n: Vec3): Vec3 => [o[0] + n[0] * r, o[1] + n[1] * r, o[2] + n[2] * r];
      this.tri(p(a, n0), p(b, n1), p(a, n1), mat, n0, n1, n1);
      this.tri(p(a, n0), p(b, n0), p(b, n1), mat, n0, n0, n1);
    }
    this.ellipsoid(a[0], a[1], a[2], r, r, r, mat, { seg: 6 });
    this.ellipsoid(b[0], b[1], b[2], r, r, r, mat, { seg: 6 });
  }

  /** Холм по функции высоты h(u, v), u и v от -1 до 1; mat(u, v) - материал клетки сетки. */
  hill(x: number, y: number, z: number, w: number, d: number, n: number, h: (u: number, v: number) => number, mat: (u: number, v: number) => number) {
    const P = (i: number, j: number): Vec3 => {
      const u = (i / n) * 2 - 1, v = (j / n) * 2 - 1;
      return [x + (u * w) / 2, y + h(u, v), z + (v * d) / 2];
    };
    const N = (i: number, j: number): Vec3 => {
      const e = 1 / n;
      const u = (i / n) * 2 - 1, v = (j / n) * 2 - 1;
      const dx = (h(u + e, v) - h(u - e, v)) / (e * w), dz = (h(u, v + e) - h(u, v - e)) / (e * d);
      return [-dx, 1, -dz];
    };
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        const m = mat(((i + 0.5) / n) * 2 - 1, ((j + 0.5) / n) * 2 - 1);
        this.tri(P(i, j), P(i, j + 1), P(i + 1, j + 1), m, N(i, j), N(i, j + 1), N(i + 1, j + 1));
        this.tri(P(i, j), P(i + 1, j + 1), P(i + 1, j), m, N(i, j), N(i + 1, j + 1), N(i + 1, j));
      }
    }
  }
}

/** Готовый спрайт: рисунок, глубина пикселей и где на нём точка привязки. */
export interface Painted {
  canvas: HTMLCanvasElement;
  /** Насколько пиксель ближе к камере, чем точка привязки, в единицах сцены. */
  depth: Float32Array;
  /** Ночной свет пикселя: 0 - не светится, иначе порядок включения 0..1 (чем меньше, тем раньше). */
  glow: Float32Array;
  w: number;
  h: number;
  /** Точка привязки в пикселях рисунка (от левого верхнего угла). */
  ax: number;
  ay: number;
  ppu: number;
}

export interface PaintOptions {
  /** Пикселей на единицу экрана. */
  ppu: number;
  seed: number;
  /** Сила тени на земле, 0 - без тени. */
  shadow?: number;
  /** Плотность мазков. */
  strokes?: number;
  /** Размер кисти в пикселях рисунка. */
  brush?: number;
  /** Тонкий контур в тон предмета (Style Bible, 4): 0 - нет, 1 - полный. */
  line?: number;
}

/** Цвет тени на земле: тёплый тёмно-коричневый, а не чёрный. */
const SHADOW_RGB = hex(0x3b2e1f);
/** Тень на стенах никогда не чёрная: сдвиг к тёплому сиреневому. */
const SHADE_TINT: RGB = [0.97, 0.93, 1.0];

function makeCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

/** Тон освещённой точки: три тона материала, лёгкая постеризация (плоскости цвета как у кисти). */
function shade(m: Material, n: Vec3, wp: Vec3, light: Vec3): RGB {
  if (m.flat) return m.base;
  const lam = dot(n, light);
  let t = clamp01((lam + 0.4) / 1.25);
  // Наполовину ступенями: мазок кладёт тон плоскостями, а не гладким компьютерным градиентом
  t = t * 0.35 + (Math.round(t * 5) / 5) * 0.65;
  let c = t < 0.55 ? mix(m.shadow, m.base, t / 0.55) : mix(m.base, m.light, (t - 0.55) / 0.45);
  if (t < 0.45) c = mul(c, SHADE_TINT);
  const k = 1 + (fbm(wp[0] * 5, wp[1] * 5, wp[2] * 5) - 0.5) * 2 * m.mottle;
  c = mul(c, k);
  if (m.patch) {
    const p = fbm(wp[0] * 2.6 + 11, wp[1] * 2.6, wp[2] * 2.6);
    const thr = 0.5 + (0.5 - (m.patchRate ?? 0.3)) * 0.4;
    const a = clamp01((p - thr) / 0.05);
    if (a > 0) c = mix(c, mul(m.patch, 0.75 + 0.35 * t), a * 0.9);
  }
  if (m.rows) {
    // Ряды по высоте: на скате крыши - черепица, на стене - доски или профлист
    const f = (wp[1] * m.rows) % 1;
    if (f < 0.22) c = mul(c, 0.86);
    else if (f > 0.85) c = mul(c, 1.07);
  }
  if (m.streaks && Math.abs(n[1]) < 0.5) {
    const h = wp[0] - wp[2];
    const s = noise3(h * 16, wp[1] * 1.2, 3.3);
    c = mul(c, 1 - m.streaks * clamp01((s - 0.55) * 3) * (0.6 + 0.4 * clamp01(1 - wp[1] * 2)));
  }
  // Затемнение у земли: предмет стоит, а не висит
  const ao = clamp01(wp[1] / 0.1);
  return mul(c, 0.8 + 0.2 * ao);
}

const css = (c: RGB, a: number) => `rgba(${Math.round(clamp01(c[0]) * 255)},${Math.round(clamp01(c[1]) * 255)},${Math.round(clamp01(c[2]) * 255)},${a.toFixed(3)})`;

/** Размытие квадратом по буферу w x h (несколько проходов - почти гаусс). */
function blur(src: Float32Array, w: number, h: number, r: number, passes = 2): Float32Array {
  let a = src, b = new Float32Array(src.length);
  const R = Math.max(1, Math.round(r));
  for (let p = 0; p < passes; p++) {
    for (let y = 0; y < h; y++) {
      let acc = 0;
      for (let x = -R; x <= R; x++) acc += a[y * w + Math.min(w - 1, Math.max(0, x))];
      for (let x = 0; x < w; x++) {
        b[y * w + x] = acc / (2 * R + 1);
        acc += a[y * w + Math.min(w - 1, x + R + 1)] - a[y * w + Math.max(0, x - R)];
      }
    }
    if (a === src) a = new Float32Array(src.length);
    for (let x = 0; x < w; x++) {
      let acc = 0;
      for (let y = -R; y <= R; y++) acc += b[Math.min(h - 1, Math.max(0, y)) * w + x];
      for (let y = 0; y < h; y++) {
        a[y * w + x] = acc / (2 * R + 1);
        acc += b[Math.min(h - 1, y + R + 1) * w + x] - b[Math.max(0, y - R) * w + x];
      }
    }
  }
  return a;
}

/** Закраска треугольника по экранным точкам: колбэк получает пиксель и барицентрические веса. */
function raster(ax: number, ay: number, bx: number, by: number, cx: number, cy: number, w: number, h: number, f: (i: number, l0: number, l1: number, l2: number) => void) {
  const area = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
  if (Math.abs(area) < 1e-9) return;
  const x0 = Math.max(0, Math.floor(Math.min(ax, bx, cx))), x1 = Math.min(w - 1, Math.ceil(Math.max(ax, bx, cx)));
  const y0 = Math.max(0, Math.floor(Math.min(ay, by, cy))), y1 = Math.min(h - 1, Math.ceil(Math.max(ay, by, cy)));
  for (let y = y0; y <= y1; y++) {
    const py = y + 0.5;
    for (let x = x0; x <= x1; x++) {
      const px = x + 0.5;
      const l0 = ((bx - px) * (cy - py) - (by - py) * (cx - px)) / area;
      const l1 = ((cx - px) * (ay - py) - (cy - py) * (ax - px)) / area;
      const l2 = 1 - l0 - l1;
      if (l0 < 0 || l1 < 0 || l2 < 0) continue;
      f(y * w + x, l0, l1, l2);
    }
  }
}

/**
 * Написать спрайт по болванке: силуэт и свет - из болванки, поверх - мазки кисти, снизу -
 * мягкая контактная тень на земле.
 */
export function paint(mats: Material[], build: (b: Blockout) => void, opts: PaintOptions): Painted {
  const v = VIEW, ppu = opts.ppu, R = rng(opts.seed);
  const bo = new Blockout();
  build(bo);
  const L = v.light;
  const shadowK = opts.shadow ?? 0.42;
  // Границы рисунка: болванка и её тень на земле
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  const grow = (p: Vec3) => {
    const sx = dot(p, v.right), sy = dot(p, v.up);
    minX = Math.min(minX, sx); maxX = Math.max(maxX, sx); minY = Math.min(minY, sy); maxY = Math.max(maxY, sy);
  };
  const toGround = (p: Vec3, k = 1): Vec3 => [p[0] - (L[0] / L[1]) * p[1] * k, 0, p[2] - (L[2] / L[1]) * p[1] * k];
  for (const t of bo.tris) for (const p of t.p) {
    grow(p);
    if (shadowK > 0) grow(toGround(p));
  }
  const pad = 8 / ppu + 0.03;
  minX -= pad; maxX += pad; minY -= pad; maxY += pad;
  const w = Math.ceil((maxX - minX) * ppu), h = Math.ceil((maxY - minY) * ppu);
  const X = (p: Vec3) => (dot(p, v.right) - minX) * ppu;
  const Y = (p: Vec3) => (maxY - dot(p, v.up)) * ppu;
  const N = w * h;

  // 1. Болванка: глубина, нормаль, точка мира и материал каждого пикселя
  const z = new Float32Array(N).fill(-Infinity);
  const nb = new Float32Array(N * 3), wb = new Float32Array(N * 3);
  const mb = new Int16Array(N).fill(-1);
  for (const t of bo.tris) {
    const [a, b, c] = t.p;
    const da = dot(a, v.toward), db = dot(b, v.toward), dc = dot(c, v.toward);
    raster(X(a), Y(a), X(b), Y(b), X(c), Y(c), w, h, (i, l0, l1, l2) => {
      const d = da * l0 + db * l1 + dc * l2;
      if (d <= z[i]) return;
      z[i] = d;
      mb[i] = t.mat;
      for (let k = 0; k < 3; k++) {
        nb[i * 3 + k] = t.n[0][k] * l0 + t.n[1][k] * l1 + t.n[2][k] * l2;
        wb[i * 3 + k] = a[k] * l0 + b[k] * l1 + c[k] * l2;
      }
    });
  }

  // 2. Свет по пикселям
  const col = new Float32Array(N * 3);
  const covered: number[] = [];
  for (let i = 0; i < N; i++) {
    if (mb[i] < 0) continue;
    covered.push(i);
    let n: Vec3 = norm([nb[i * 3], nb[i * 3 + 1], nb[i * 3 + 2]]);
    // Сторона к зрителю: у открытых поверхностей нормаль могла смотреть от камеры
    if (dot(n, v.toward) < 0) n = [-n[0], -n[1], -n[2]];
    nb[i * 3] = n[0]; nb[i * 3 + 1] = n[1]; nb[i * 3 + 2] = n[2];
    const c = shade(mats[mb[i]], n, [wb[i * 3], wb[i * 3 + 1], wb[i * 3 + 2]], L);
    col[i * 3] = c[0]; col[i * 3 + 1] = c[1]; col[i * 3 + 2] = c[2];
  }
  // Светлая кромка вместо контура: верх, под которым начинается стена, и освещённый край силуэта
  const rim = Math.max(1, Math.round(ppu / 110));
  for (const i of covered) {
    const x = i % w, y = (i / w) | 0;
    const ny = nb[i * 3 + 1];
    let k = 0;
    if (ny > 0.6) {
      const j = (y + rim) * w + x;
      if (y + rim < h && mb[j] >= 0 && nb[j * 3 + 1] < 0.4 && Math.abs(z[j] - z[i]) < 0.15) k = 0.16;
    }
    if (!k && y > 0 && mb[i - w] < 0 && dot([nb[i * 3], ny, nb[i * 3 + 2]], L) > 0.3) k = 0.12;
    if (k && !mats[mb[i]].flat) for (let c = 0; c < 3; c++) col[i * 3 + c] = col[i * 3 + c] * (1 + k) + [0.03, 0.02, 0][c];
  }

  // 3. Мазки кисти цветом болванки
  const canvas = makeCanvas(w, h);
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(w, h);
  for (const i of covered) {
    img.data[i * 4] = clamp01(col[i * 3]) * 255;
    img.data[i * 4 + 1] = clamp01(col[i * 3 + 1]) * 255;
    img.data[i * 4 + 2] = clamp01(col[i * 3 + 2]) * 255;
    img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  const brush = opts.brush ?? 1;
  const count = Math.round((covered.length / (9 * brush * brush)) * (opts.strokes ?? 1));
  for (let s = 0; s < count && covered.length; s++) {
    const i = covered[(R() * covered.length) | 0];
    const m = mats[mb[i]];
    if (m.flat) continue;
    const x = i % w, y = (i / w) | 0;
    const n: Vec3 = [nb[i * 3], nb[i * 3 + 1], nb[i * 3 + 2]];
    let ang: number;
    if (m.grain === 'up') ang = -Math.PI / 2 + (R() - 0.5) * 0.9;
    else if (m.grain === 'vertical') ang = -Math.PI / 2 + (R() - 0.5) * 0.25;
    else if (m.grain === 'dab') ang = R() * Math.PI;
    else {
      // Вдоль стены: горизонталь поверхности на экране
      const t: Vec3 = [-n[2], 0, n[0]];
      const sx = dot(t, v.right), sy = -dot(t, v.up);
      ang = Math.hypot(sx, sy) > 0.2 && n[1] < 0.7 ? Math.atan2(sy, sx) + (R() - 0.5) * 0.3 : (R() - 0.5) * 0.6;
    }
    let len = brush * m.stroke * (3.5 + R() * 7);
    const wid = brush * m.stroke * (1.4 + R() * 2.2);
    // Мазок не переходит на другой предмет: конец мазка той же поверхности и глубины
    for (let tries = 0; tries < 2; tries++) {
      const ex = Math.round(x + Math.cos(ang) * len * 0.5), ey = Math.round(y + Math.sin(ang) * len * 0.5);
      const fx = Math.round(x - Math.cos(ang) * len * 0.5), fy = Math.round(y - Math.sin(ang) * len * 0.5);
      const ok = (px: number, py: number) => px >= 0 && py >= 0 && px < w && py < h && mb[py * w + px] === mb[i] && Math.abs(z[py * w + px] - z[i]) < 0.06;
      if (ok(ex, ey) && ok(fx, fy)) break;
      len *= 0.45;
    }
    let c: RGB = [col[i * 3], col[i * 3 + 1], col[i * 3 + 2]];
    if (m.speck && R() < (m.speckRate ?? 0)) c = mix(m.speck, c, 0.15);
    else {
      // Тёплый мазок светлее, холодный темнее - живая плёнка цвета, а не шум
      const j = (R() - 0.5) * 3 * m.jitter;
      const warm = j * 0.5;
      c = [c[0] * (1 + j + warm), c[1] * (1 + j), c[2] * (1 + j - warm)];
    }
    ctx.fillStyle = css(c, 0.45 + R() * 0.4);
    ctx.beginPath();
    ctx.ellipse(x + 0.5, y + 0.5, Math.max(0.6, len / 2), Math.max(0.5, wid / 2), ang, 0, Math.PI * 2);
    ctx.fill();
  }

  // Тонкий контур в тон предмета: силуэт и перепад глубины (крыша над стеной, человек перед домом)
  const line = opts.line ?? 0.55;
  if (line > 0) {
    const img2 = ctx.getImageData(0, 0, w, h), q = img2.data;
    const lw = Math.max(1, Math.round(ppu / 128));
    for (const i of covered) {
      const x = i % w, y = (i / w) | 0;
      let edge = false;
      for (const [dx, dy] of [[lw, 0], [-lw, 0], [0, lw], [0, -lw]]) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) { edge = true; break; }
        const j = ny * w + nx;
        if (mb[j] < 0 || z[i] - z[j] > 0.1) { edge = true; break; }
      }
      if (!edge || mats[mb[i]].flat) continue;
      const k = 1 - line * 0.55;
      q[i * 4] *= k * 1.04; q[i * 4 + 1] *= k * 0.98; q[i * 4 + 2] *= k * 0.92;
    }
    ctx.putImageData(img2, 0, 0);
  }

  // 4. Живой край силуэта: маска по слегка размытому покрытию со сдвигом по шуму
  const cov = new Float32Array(N);
  for (const i of covered) cov[i] = 1;
  const soft = blur(cov, w, h, Math.max(1, ppu / 90), 1);
  const out = ctx.getImageData(0, 0, w, h);
  const depth = new Float32Array(N).fill(-50);
  // Тень: длинная по свету и короткая контактная у основания
  let shadowA: Float32Array | null = null;
  if (shadowK > 0) {
    const long = new Float32Array(N), contact = new Float32Array(N);
    for (const t of bo.tris) {
      for (const [buf, k] of [[long, 1], [contact, 0.18]] as const) {
        const [a, b, c] = t.p.map((p) => toGround(p, k));
        raster(X(a), Y(a), X(b), Y(b), X(c), Y(c), w, h, (i) => { buf[i] = 1; });
      }
    }
    const lb = blur(long, w, h, ppu * 0.035), cb = blur(contact, w, h, ppu * 0.03);
    shadowA = new Float32Array(N);
    for (let i = 0; i < N; i++) shadowA[i] = Math.min(1, lb[i] * shadowK + cb[i] * shadowK * 0.7);
  }
  const d = out.data;
  // Ночной свет: окно загорается целиком - порядок по клетке в мире размером с окно
  const glow = new Float32Array(N);
  for (const i of covered) {
    const g = mats[mb[i]].glow;
    if (g === undefined) continue;
    if (g !== true) glow[i] = Math.max(0.001, g);
    else {
      const wx = Math.floor(wb[i * 3] * 5 + 50), wy = Math.floor(wb[i * 3 + 1] / 0.24), wz = Math.floor(wb[i * 3 + 2] * 5 + 50);
      glow[i] = 0.05 + hash3(wx, wy + opts.seed * 0.37, wz) * 0.95;
    }
  }
  for (let i = 0; i < N; i++) {
    const x = i % w, y = (i / w) | 0;
    const edge = soft[i] > 0 && soft[i] < 1 ? (noise3(x * 0.35, y * 0.35, opts.seed) - 0.5) * 0.5 : 0;
    const a = mb[i] >= 0 ? clamp01((soft[i] - 0.5 + edge) * 2.5 + 0.5) : 0;
    const sy = maxY - (y + 0.5) / ppu;
    const ground = sy * GROUND_DEPTH;
    const s = shadowA ? shadowA[i] : 0;
    // Предмет поверх тени
    const oa = a, sa = s * (1 - oa);
    const ta = oa + sa;
    if (ta <= 0.003) {
      d[i * 4 + 3] = 0;
      continue;
    }
    for (let k = 0; k < 3; k++) d[i * 4 + k] = (d[i * 4 + k] * oa + SHADOW_RGB[k] * 255 * sa) / ta;
    d[i * 4 + 3] = ta * 255;
    depth[i] = oa > 0.02 ? z[i] : ground;
  }
  ctx.putImageData(out, 0, 0);
  return { canvas, depth, glow, w, h, ax: -minX * ppu, ay: maxY * ppu, ppu };
}

/**
 * Плоский рисунок без болванки (пучок травы, цветок): кисть в пикселях, глубина - как у стоящей
 * фигуры выше точки привязки и как у земли ниже неё.
 */
export function paintFlat(w: number, h: number, ax: number, ay: number, ppu: number, draw: (ctx: CanvasRenderingContext2D) => void): Painted {
  const canvas = makeCanvas(w, h);
  draw(canvas.getContext('2d')!);
  const depth = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const sy = (ay - (y + 0.5)) / ppu;
    const dd = sy > 0 ? sy * STANDEE_DEPTH : sy * GROUND_DEPTH;
    for (let x = 0; x < w; x++) depth[y * w + x] = dd;
  }
  return { canvas, depth, glow: new Float32Array(w * h), w, h, ax, ay, ppu };
}

export { css as rgba, makeCanvas };
