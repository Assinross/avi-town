// Дома и здания прототипа 009 в духе макета Avi (specs/008-cozy-graphics/shots/mockup-bunker.webp):
// кремовые, кирпичные и пастельные стены, красные, синие и зелёные крыши, белые рамы окон,
// полосатые маркизы, заборы, деревья во дворах, машины на парковках.
// Всё в координатах участка: u (x) - вдоль улицы, f (z) - к улице, фасад смотрит на +z.

import { Blockout, hex, material, mix, paint, rng, type Material, type Painted, type RGB } from './painter';
import { MATS, M, PPU } from './art';

export const H_FLOOR = 0.24;

// Цвета макета
export const WALLS = [0xe8d8b6, 0xe2b48a, 0xbac6cc, 0xb5664a, 0xe3c470, 0xeee6d6, 0xc9b49a, 0xd99a7a];
export const ROOFS = [0xc4553b, 0x4f74a8, 0x5f8a5a, 0x8a5a3c, 0xd27a3c, 0x7d7f85];
export const AWNINGS: [number, number][] = [[0xd8452f, 0xf2ead8], [0x3f8fb0, 0xf2ead8], [0x5f9a52, 0xf2ead8], [0xe0a030, 0x8a4a2a]];
export const CARS = [0xd8452f, 0x3f7fc0, 0xe8e2d4, 0xe0b030, 0x4f8a5a, 0x7a7f88];

/** Набор материалов одного рисунка: общие плюс свои цвета стен, крыш, машин. */
export class Kit {
  readonly mats: Material[] = [...MATS];
  private cache = new Map<string, number>();

  constructor(readonly b: Blockout) {}

  /** Материал по основному цвету: светлее к тёплому белому, тень - тёплая сиреневая. */
  tone(c: number, grain: Material['grain'] = 'along', opts: Partial<Material> = {}): number {
    const key = `${c}:${grain}:${JSON.stringify(opts)}`;
    const have = this.cache.get(key);
    if (have !== undefined) return have;
    const base = hex(c);
    const light = mix(base, [1, 0.96, 0.86] as RGB, 0.3);
    const shadow: RGB = [base[0] * 0.64, base[1] * 0.58, base[2] * 0.66];
    const m = material(0, 0, 0, grain, { mottle: 0.1, jitter: 0.06, ...opts });
    m.base = base;
    m.light = light;
    m.shadow = shadow;
    this.mats.push(m);
    this.cache.set(key, this.mats.length - 1);
    return this.mats.length - 1;
  }

  /** Окна по периметру этажей коробки: белая рама, тёмно-голубое стекло. */
  windows(x: number, y0: number, z: number, w: number, d: number, floors: number, opts: { front?: boolean; step?: number; skipDoor?: number; wide?: boolean } = {}) {
    const step = opts.step ?? 0.2;
    const ww = opts.wide ? 0.13 : 0.085, wh = 0.11;
    for (let fl = 0; fl < floors; fl++) {
      const y = y0 + fl * H_FLOOR + 0.07;
      const sides: [number, number, number, number][] = [[0, 1, w, d], [0, -1, w, d], [1, 0, d, w], [-1, 0, d, w]];
      for (const [sx, sz, len, other] of sides) {
        const n = Math.max(1, Math.floor(len / step));
        for (let k = 0; k < n; k++) {
          const t = (k + 0.5) / n - 0.5;
          if (fl === 0 && sz === 1 && opts.skipDoor !== undefined && Math.abs(t * len - opts.skipDoor) < 0.09) continue;
          const px = sx ? x + (sx * other) / 2 : x + t * len, pz = sz ? z + (sz * other) / 2 : z + t * len;
          const fw = sx ? 0.012 : ww + 0.025, fd = sx ? ww + 0.025 : 0.012;
          this.b.box(px + sx * 0.004, y - 0.012, pz + sz * 0.004, fw, wh + 0.024, fd, M.frame);
          this.b.box(px + sx * 0.008, y, pz + sz * 0.008, sx ? 0.012 : ww, wh, sx ? ww : 0.012, M.glass);
        }
      }
    }
  }

  door(x: number, z: number, color = M.door) {
    this.b.box(x, 0.03, z + 0.004, 0.09, 0.15, 0.012, M.frame);
    this.b.box(x, 0.03, z + 0.009, 0.07, 0.135, 0.012, color);
  }

  /** Маркиза над витриной: наклонные полосы двух цветов. */
  awning(x0: number, x1: number, z: number, y: number, depth: number, a: number, c: number) {
    const ma = this.tone(a, 'along', { mottle: 0.04 }), mc = this.tone(c, 'along', { mottle: 0.04 });
    const n = Math.max(3, Math.round((x1 - x0) / 0.06));
    for (let i = 0; i < n; i++) {
      const u0 = x0 + ((x1 - x0) * i) / n, u1 = x0 + ((x1 - x0) * (i + 1)) / n;
      this.b.quad([u0, y, z], [u1, y, z], [u1, y - 0.07, z + depth], [u0, y - 0.07, z + depth], i % 2 ? mc : ma);
    }
    this.b.box((x0 + x1) / 2, y - 0.085, z + depth, x1 - x0, 0.02, 0.008, ma);
  }

  sign(x: number, y: number, z: number, w: number, color: number) {
    this.b.box(x, y, z, w, 0.07, 0.02, this.tone(color, 'along', { mottle: 0.05 }));
    for (let i = 0; i < 3; i++) this.b.box(x - w * 0.3 + i * w * 0.3, y + 0.025, z + 0.012, w * 0.18, 0.022, 0.004, M.frame);
  }

  /** Низкий забор по периметру прямоугольника, с калиткой спереди. */
  fence(x: number, z: number, w: number, d: number, mat = M.planks, gate = 0.22) {
    const h = 0.075;
    const run = (ax: number, az: number, bx: number, bz: number) => {
      const len = Math.hypot(bx - ax, bz - az), n = Math.max(1, Math.round(len / 0.09));
      for (let i = 0; i <= n; i++) this.b.box(ax + ((bx - ax) * i) / n, 0, az + ((bz - az) * i) / n, 0.014, h, 0.014, mat);
      const cx = (ax + bx) / 2, cz = (az + bz) / 2;
      this.b.box(cx, h * 0.6, cz, Math.abs(bx - ax) + 0.01, 0.012, Math.abs(bz - az) + 0.01, mat);
    };
    const x0 = x - w / 2, x1 = x + w / 2, z0 = z - d / 2, z1 = z + d / 2;
    run(x0, z0, x1, z0);
    run(x0, z0, x0, z1);
    run(x1, z0, x1, z1);
    run(x0, z1, x - gate / 2, z1);
    run(x + gate / 2, z1, x1, z1);
  }

  car(x: number, z: number, along: 'x' | 'z', color: number) {
    const m = this.tone(color, 'along', { mottle: 0.04 });
    const L = 0.2, W = 0.1;
    const [lx, lz] = along === 'x' ? [L, W] : [W, L];
    this.b.box(x, 0.02, z, lx, 0.05, lz, m);
    this.b.box(x, 0.07, z, lx * (along === 'x' ? 0.55 : 0.85), 0.04, lz * (along === 'x' ? 0.85 : 0.55), M.visor);
    this.b.box(x, 0.105, z, lx * (along === 'x' ? 0.5 : 0.8), 0.012, lz * (along === 'x' ? 0.8 : 0.5), m);
    for (const s of [-1, 1]) for (const t of [-1, 1]) {
      const wx = along === 'x' ? x + s * L * 0.32 : x + t * W * 0.5, wz = along === 'x' ? z + t * W * 0.5 : z + s * L * 0.32;
      this.b.box(wx, 0, wz, 0.04, 0.035, 0.04, M.boots);
    }
  }

  tree(x: number, z: number, s = 1, seed = 1, autumn = false) {
    const R = rng(seed);
    this.b.capsule([x, 0, z], [x, 0.18 * s, z], 0.02 * s, M.bark, 5);
    const leaf = autumn ? M.leafAutumn : R() < 0.5 ? M.leaf : M.leaf2;
    for (let i = 0; i < 3; i++) {
      const a = R() * 6.28, r = i ? 0.05 * s : 0;
      this.b.ellipsoid(x + Math.cos(a) * r, 0.25 * s + R() * 0.05 * s, z + Math.sin(a) * r, 0.1 * s, 0.09 * s, 0.1 * s, leaf, { bump: 0.3, seed: R() * 9, seg: 8 });
    }
  }

  bush(x: number, z: number, s = 1, seed = 1) {
    this.b.ellipsoid(x, 0.03 * s, z, 0.06 * s, 0.05 * s, 0.06 * s, seed % 2 ? M.leaf : M.leaf2, { bump: 0.3, seed, seg: 7, flatBottom: true });
  }

  /** Цилиндрический бак с крышкой. */
  tank(x: number, z: number, r: number, h: number, color: number, y = 0) {
    const m = this.tone(color, 'vertical', { mottle: 0.06 });
    this.b.cylinder(x, y, z, r, h, m, 12);
    this.b.cylinder(x, y + h, z, r * 1.02, 0.03, M.metalDark, 12, r * 0.7);
  }

  /** Труба с красно-белыми кольцами. */
  stack(x: number, z: number, h: number, r = 0.05, y = 0) {
    const red = this.tone(0xc94a35, 'vertical'), white = this.tone(0xeae2d2, 'vertical');
    const n = 5;
    for (let i = 0; i < n; i++) this.b.cylinder(x, y + (h * i) / n, z, r * (1 - i * 0.04), h / n, i % 2 ? white : red, 10, r * (1 - (i + 1) * 0.04));
  }

  /** Дом: цоколь, этажи, окна, дверь, крыша (двускатная, вальмовая или плоская с парапетом). */
  house(x: number, z: number, w: number, d: number, floors: number, wall: number, roof: number, kind: 'gable' | 'hip' | 'flat', opts: { door?: number; chimney?: boolean; seed?: number } = {}) {
    const mw = this.tone(wall, 'along', { mottle: 0.12, streaks: 0.08 });
    const mr = this.tone(roof, 'along', { mottle: 0.12, rows: 26 });
    this.b.box(x, 0, z, w + 0.02, 0.03, d + 0.02, M.concrete);
    const top = 0.03 + floors * H_FLOOR;
    this.b.box(x, 0.03, z, w, top - 0.03, d, mw);
    this.windows(x, 0.03, z, w, d, floors, { skipDoor: opts.door ?? 0 });
    this.door(x + (opts.door ?? 0), z + d / 2);
    if (kind === 'gable') this.b.gable(x, top, z, w, d, Math.min(w, d) * 0.42, mr, mw, w >= d ? 'x' : 'z');
    else if (kind === 'hip') this.b.hip(x, top, z, w, d, Math.min(w, d) * 0.38, mr);
    else {
      this.b.box(x, top, z, w + 0.02, 0.035, d + 0.02, mw, { top: this.tone(0x9a958c, 'dab') });
      // На плоской крыше - вентиляция и кондиционеры, как на макете
      const R = rng((opts.seed ?? 1) * 17 + Math.round(w * 100));
      for (let i = 0; i < (w > 1 ? 3 : 1); i++) {
        const ux = x + (R() - 0.5) * w * 0.6, uz = z + (R() - 0.5) * d * 0.5;
        this.b.box(ux, top + 0.035, uz, 0.1 + R() * 0.06, 0.05 + R() * 0.04, 0.08 + R() * 0.05, R() < 0.5 ? M.metal : M.concreteLight);
      }
    }
    if (opts.chimney) this.b.box(x + w * 0.25, top, z - d * 0.15, 0.06, kind === 'flat' ? 0.1 : Math.min(w, d) * 0.42, 0.06, M.brick);
    return top;
  }
}

/** Рисунок по набору: поворот на четверть rel относительно вида 0 (как у бункера), можно дробный. */
export function draw(rel: number, seed: number, build: (k: Kit) => void, opts: { shadow?: number; ppu?: number; brush?: number } = {}): Painted {
  let kit: Kit | null = null;
  const mats: Material[] = [];
  const painted = paint(mats, (b) => {
    kit = new Kit(b);
    b.push(0, 0, 0, (rel * Math.PI) / 2);
    build(kit);
    b.pop();
    mats.push(...kit.mats);
  }, { ppu: opts.ppu ?? PPU, seed, shadow: opts.shadow ?? 0.36, brush: opts.brush ?? 0.8 });
  return painted;
}

export const pick = <T>(list: readonly T[], v: number) => list[((v % list.length) + list.length) % list.length];

/** Промзона и ферма - по клетке: мастерская, цех, завод; грядки, сарай, амбар с силосом. */
export function paintCell(zone: 'I' | 'A', level: number, v: number, rel: number): Painted {
  return draw(rel, 2000 + v * 11 + level * 5 + (zone === 'A' ? 500 : 0), (k) => {
    if (zone === 'I') {
      const wall = pick([0xc9bba4, 0xa8b0b5, 0xb07a62, 0xd2ccc0, 0x9aa88a, 0xc4a070], v), roof = pick([0x8a8f94, 0x5f7f9a, 0xa0522d, 0x6f8a5a, 0xb08a4a], v * 3 + 1);
      if (level === 1) {
        const mw = k.tone(wall, 'along', { rows: 30, mottle: 0.1 }), mr = k.tone(roof, 'along', { rows: 40 });
        k.b.box(0, 0, -0.05, 0.7, 0.3, 0.58, mw);
        k.b.gable(0, 0.3, -0.05, 0.7, 0.58, 0.12, mr, mw, 'x');
        k.b.box(-0.08, 0, 0.245, 0.3, 0.22, 0.012, M.metalDark);
        k.b.box(0.24, 0, 0.32, 0.1, 0.08, 0.08, M.crate);
        k.b.cylinder(0.33, 0, 0.18, 0.035, 0.08, M.rust, 8);
        return;
      }
      if (level === 2) {
        const mw = k.tone(wall, 'along', { rows: 28, mottle: 0.12 });
        k.b.box(0, 0, -0.02, 0.84, 0.42, 0.74, mw, { top: k.tone(roof, 'dab') });
        for (let i = 0; i < 3; i++) k.b.box(-0.27 + i * 0.27, 0.42, -0.02, 0.2, 0.06, 0.6, M.glass);
        k.b.box(0.15, 0, 0.355, 0.32, 0.26, 0.012, M.metalDark);
        k.stack(-0.3, -0.25, 0.45, 0.04, 0.42);
        return;
      }
      const mw = k.tone(wall, 'along', { rows: 26 });
      k.b.box(-0.12, 0, 0.05, 0.6, 0.4, 0.66, mw, { top: k.tone(roof, 'dab') });
      k.tank(0.3, -0.22, 0.12, 0.34, 0xd9d4c8);
      k.tank(0.3, 0.12, 0.1, 0.28, 0x9aa8b0);
      k.stack(-0.3, -0.3, 0.75, 0.055);
      k.b.box(0.08, 0.3, -0.05, 0.3, 0.025, 0.025, M.metal);
      return;
    }
    // Ферма: грядки рядами, на 2-3 уровне - постройки
    const crop = pick([M.crop0, M.crop1, M.crop2], v);
    const rows = level === 1 ? 5 : 3;
    for (let i = 0; i < rows; i++) {
      const x = -0.36 + (i * 0.72) / (rows - 1 || 1);
      k.b.box(x, 0, level === 1 ? 0 : 0.18, 0.1, 0.02, level === 1 ? 0.84 : 0.5, M.earth);
      for (let j = 0; j < (level === 1 ? 6 : 4); j++) {
        const z = (level === 1 ? -0.36 : -0.02) + j * 0.14;
        k.b.ellipsoid(x, 0.035, z, 0.04, 0.035, 0.04, crop, { bump: 0.3, seed: i * 9 + j, seg: 6 });
      }
    }
    if (level === 2) {
      const mw = k.tone(0x9a7653, 'along', { rows: 30 }), mr = k.tone(0x7d7f85, 'along', { rows: 40 });
      k.b.box(0, 0, -0.3, 0.5, 0.2, 0.3, mw);
      k.b.gable(0, 0.2, -0.3, 0.5, 0.3, 0.1, mr, mw, 'x');
    }
    if (level === 3) {
      const mw = k.tone(0xb0503a, 'along', { rows: 32 }), mr = k.tone(0x6f5a4a, 'along', { rows: 36 });
      k.b.box(-0.12, 0, -0.25, 0.48, 0.28, 0.38, mw);
      k.b.gable(-0.12, 0.28, -0.25, 0.48, 0.38, 0.16, mr, mw, 'z');
      k.b.box(-0.12, 0, -0.055, 0.16, 0.18, 0.012, M.frame);
      k.tank(0.27, -0.25, 0.1, 0.5, 0xc9c2b4);
      k.b.ellipsoid(0.27, 0.53, -0.25, 0.1, 0.06, 0.1, M.metal, { seg: 8 });
    }
  });
}

/** Стройплощадка: плита, леса, начатые стены. */
export function paintSite(size: number, progress: number, rel: number): Painted {
  return draw(rel, 3000 + size * 10 + Math.round(progress * 4), (k) => {
    const s = size * 0.8;
    k.b.box(0, 0, 0, s, 0.03, s, M.concrete);
    const h = 0.1 + progress * 0.4 * Math.min(2, size);
    k.b.box(0, 0.03, 0, s * 0.8, h, s * 0.8, M.concreteLight);
    const n = 3 + size;
    for (let i = 0; i <= n; i++) {
      for (const [x, z] of [[-s / 2 + (s * i) / n, s / 2], [-s / 2 + (s * i) / n, -s / 2], [s / 2, -s / 2 + (s * i) / n], [-s / 2, -s / 2 + (s * i) / n]]) k.b.box(x, 0, z, 0.015, h + 0.12, 0.015, M.planks);
    }
    for (let y = 0.12; y < h + 0.1; y += 0.12) k.b.box(0, y, s / 2, s, 0.012, 0.03, M.planks);
    k.b.box(s * 0.35, 0.03, s * 0.55, 0.16, 0.06, 0.1, M.planks);
  });
}

/** Здания служб и базы по id (размер из buildings.json). */
export function paintBuilding(id: string, size: number, rel: number): Painted {
  return draw(rel, 4000 + id.length * 37 + size, (k) => {
    const b = k.b;
    switch (id) {
      case 'school': {
        k.house(0, -0.3, 1.5, 0.8, 2, 0xb5664a, 0x5f8a5a, 'hip');
        k.b.box(0, 0, 0.5, 1.6, 0.01, 0.6, M.sand);
        k.fence(0, 0.1, 1.85, 1.85, M.metal, 0.4);
        b.box(0.75, 0, 0.6, 0.02, 0.6, 0.02, M.metal);
        b.box(0.83, 0.48, 0.6, 0.15, 0.1, 0.01, k.tone(0x3f7fc0));
        k.tree(-0.75, 0.7, 1, 4);
        k.tree(-0.4, 0.75, 0.8, 9, true);
        return;
      }
      case 'clinic': {
        const top = k.house(0, -0.15, 1.5, 0.9, 3, 0xeee6d6, 0xd8452f, 'flat');
        const red = k.tone(0xd8452f);
        b.box(0, top + 0.035, -0.15, 0.36, 0.012, 0.1, red);
        b.box(0, top + 0.035, -0.15, 0.1, 0.012, 0.36, red);
        b.box(0, 0.4, 0.31, 0.12, 0.04, 0.012, red);
        b.box(0, 0.36, 0.31, 0.04, 0.12, 0.012, red);
        k.car(0.55, 0.65, 'x', 0xeeeeee);
        k.tree(-0.75, 0.65, 0.9, 6);
        return;
      }
      case 'plant': {
        const mw = k.tone(0xa8b0b5, 'along', { rows: 26 });
        b.box(-0.2, 0, 0, 1.1, 0.5, 1.2, mw, { top: k.tone(0x7d7f85, 'dab') });
        k.stack(0.55, -0.45, 1.0, 0.07);
        k.stack(0.55, 0.0, 0.85, 0.06);
        b.box(0.55, 0, 0.55, 0.4, 0.25, 0.35, M.metal);
        for (let i = 0; i < 3; i++) b.box(0.42 + i * 0.13, 0.25, 0.55, 0.03, 0.12, 0.25, M.metalDark);
        return;
      }
      case 'pump': {
        // Водонапорная башня на ногах, как на макете
        for (const [x, z] of [[-0.18, -0.18], [0.18, -0.18], [0.18, 0.18], [-0.18, 0.18]]) b.capsule([x, 0, z], [x * 0.6, 0.62, z * 0.6], 0.016, M.metalDark, 5);
        b.box(0, 0.3, 0, 0.3, 0.015, 0.015, M.metalDark);
        b.box(0, 0.3, 0, 0.015, 0.015, 0.3, M.metalDark);
        k.tank(0, 0, 0.2, 0.28, 0xd9d4c8, 0.62);
        b.ellipsoid(0, 0.93, 0, 0.2, 0.06, 0.2, M.metal, { seg: 10 });
        b.cylinder(0.25, 0, 0.25, 0.08, 0.06, M.concrete, 8);
        return;
      }
      case 'mine': {
        b.box(-0.3, 0, 0.2, 0.8, 0.28, 0.6, k.tone(0x9a7653, 'along', { rows: 30 }), { top: k.tone(0x7d7f85, 'dab') });
        for (const [x, z] of [[0.25, -0.35], [0.65, -0.35], [0.65, 0.05], [0.25, 0.05]]) b.capsule([x, 0, z], [0.45, 0.95, -0.15], 0.018, M.rust, 5);
        b.cylinder(0.45, 0.92, -0.15, 0.1, 0.03, M.metalDark, 10);
        b.ellipsoid(-0.5, 0, -0.5, 0.3, 0.15, 0.25, M.ore, { bump: 0.25, seed: 3, flatBottom: true });
        return;
      }
      case 'lab': case 'lab2': case 'lab3': {
        const tier = id === 'lab' ? 1 : id === 'lab2' ? 2 : 3;
        const top = k.house(-0.1, 0, 1.3, 1.1, 1 + tier, 0xd9dde0, 0x2f6fb0, 'flat');
        b.ellipsoid(0.3, top, -0.2, 0.25, 0.22, 0.25, k.tone(0xe6e6e6), { seg: 12 });
        b.box(-0.45, top, 0.2, 0.02, 0.3, 0.02, M.metal);
        b.cylinder(-0.45, top + 0.3, 0.2, 0.12, 0.02, k.tone(0xe6e6e6), 12);
        return;
      }
      case 'workshop': case 'outpost': {
        const mw = k.tone(id === 'outpost' ? 0x76825a : 0x8f9aa2, 'along', { rows: 30 });
        b.box(0, 0, -0.15, 1.3, 0.42, 1.1, mw);
        b.gable(0, 0.42, -0.15, 1.3, 1.1, 0.25, k.tone(0x6f7a80, 'along', { rows: 40 }), mw, 'z');
        b.box(0, 0, 0.405, 0.7, 0.34, 0.012, M.metalDark);
        b.box(0, 0.002, 0.7, 0.6, 0.004, 0.3, M.hazard);
        if (id === 'outpost') {
          b.box(0.8, 0, -0.8, 0.02, 0.8, 0.02, M.metal);
          b.box(0.88, 0.66, -0.8, 0.16, 0.11, 0.01, k.tone(0x2f6fb0));
        }
        return;
      }
      case 'radar': {
        b.box(0, 0, 0, 0.4, 0.2, 0.4, M.concrete);
        b.cylinder(0, 0.2, 0, 0.04, 0.4, M.metal, 8);
        b.ellipsoid(0, 0.66, 0, 0.26, 0.07, 0.26, k.tone(0xe6e6e6), { seg: 12 });
        b.box(0, 0.66, 0, 0.02, 0.16, 0.02, M.metalDark);
        return;
      }
      default: {
        // ПВО: площадка с мешками, поворотная башня, ствол или пакет ракет по типу
        b.box(0, 0, 0, 0.8, 0.04, 0.8, M.concrete);
        for (const [x, z, r] of [[0, 0.34, 0], [-0.34, 0, 1], [0.34, 0, 1]] as const) {
          b.push(x, 0.04, z, r * Math.PI / 2);
          for (let i = 0; i < 4; i++) b.ellipsoid(-0.2 + i * 0.13, 0.03, 0, 0.065, 0.032, 0.045, M.sack, { bump: 0.12, seed: i, seg: 7, flatBottom: true });
          b.pop();
        }
        b.cylinder(0, 0.04, 0, 0.16, 0.1, M.military, 12);
        b.box(0, 0.14, 0, 0.24, 0.12, 0.2, M.military);
        const accent = k.tone({ aa_avalanche: 0xd8452f, aa_phoenix: 0x8a9399, aa_laser: 0x4fd3ff, aa_plasma: 0x7dff6a, aa_fusion: 0xff7af2 }[id] ?? 0x8a9399, 'along', { flat: id === 'aa_laser' || id === 'aa_plasma' || id === 'aa_fusion' });
        b.capsule([0.04, 0.2, 0], [0.32, 0.5, -0.22], 0.025, M.metalDark, 6);
        b.capsule([-0.04, 0.2, 0], [0.24, 0.5, -0.28], 0.025, M.metalDark, 6);
        b.ellipsoid(0.3, 0.5, -0.25, 0.04, 0.04, 0.04, accent, { seg: 6 });
      }
    }
  });
}

/** Руины: обломки стен с пустыми окнами и кучи кирпича. */
export function paintRuin(v: number, rel: number): Painted {
  return draw(rel, 5000 + v, (k) => {
    const R = rng(v * 7 + 1);
    const wall = k.tone(pick([0xa8664d, 0xa69a88, 0xb5a58a], v), 'along', { mottle: 0.25, streaks: 0.3 });
    const h1 = 0.25 + R() * 0.3, h2 = 0.15 + R() * 0.25;
    k.b.box(-0.1, 0, -0.3, 0.7, h1, 0.06, wall);
    k.b.box(-0.42, 0, 0, 0.06, h2, 0.6, wall);
    for (let i = 0; i < 2; i++) k.b.box(-0.25 + i * 0.3, h1 * 0.45, -0.265, 0.1, 0.1, 0.012, M.pit);
    for (let i = 0; i < 5; i++) {
      k.b.push((R() - 0.3) * 0.6, 0, (R() - 0.3) * 0.6, R() * 3);
      k.b.box(0, 0, 0, 0.08 + R() * 0.1, 0.04 + R() * 0.05, 0.07 + R() * 0.08, i % 2 ? wall : M.concrete);
      k.b.pop();
    }
  }, { shadow: 0.4 });
}

/** Ржавая машина в пустоши. */
export function paintWreck(v: number, rel: number): Painted {
  return draw(rel, 6000 + v, (k) => {
    k.b.push(0, 0, 0, (v % 4) * 0.4);
    const rust = k.tone(pick([0x9a5a36, 0x7d6a5a, 0x8a4a2b], v), 'dab', { mottle: 0.3 });
    k.b.box(0, 0.015, 0, 0.34, 0.08, 0.17, rust);
    k.b.box(-0.03, 0.095, 0, 0.18, 0.06, 0.15, rust);
    k.b.box(-0.03, 0.1, 0, 0.17, 0.045, 0.152, M.pit);
    k.b.pop();
  }, { shadow: 0.42 });
}

/** Фонарь у тротуара: тёмный столб, плечо над дорогой, тёплая лампа. */
export function paintLamp(rel: number): Painted {
  return draw(rel, 7000, (k) => {
    k.b.cylinder(0, 0, 0, 0.012, 0.42, M.metalDark, 6);
    k.b.box(-0.05, 0.41, 0, 0.11, 0.012, 0.012, M.metalDark);
    k.b.box(-0.1, 0.39, 0, 0.04, 0.025, 0.03, M.lamp);
  }, { shadow: 0.3 });
}

/** Колышки с лентой цвета зоны по углам пустого участка: зона читается без заливки. */
export function paintStakes(zone: string): Painted {
  return draw(0, 8000 + zone.charCodeAt(0), (k) => {
    const ribbon = k.tone({ R: 0x5f9a52, C: 0x3f8fb0, I: 0xe0a030, A: 0x9a6a3a }[zone] ?? 0xe0a030, 'along', { mottle: 0.03 });
    for (const [x, z] of [[-0.42, -0.42], [0.42, -0.42], [0.42, 0.42], [-0.42, 0.42]]) {
      k.b.box(x, 0, z, 0.025, 0.11, 0.025, M.planks);
      k.b.box(x, 0.08, z, 0.03, 0.025, 0.03, ribbon);
    }
  }, { shadow: 0.25 });
}

/** Цвета легковых по типу машины в traffic.ts: хэтчбек, седан, универсал, такси, полиция. */
const CAR_COLORS = [0xd8452f, 0x3f7fc0, 0x5f9a6a, 0xe8b830, 0xeeeae2];

/**
 * Машина на улице, капот к +z, повёрнута на dir восьмых оборота относительно вида 0.
 * model 0..4 - легковые (как в traffic.ts), 5 - фургон, 6 - броневик отряда; siren - кадр
 * мигалки броневика: 0 - выключена, 1 - красная, 2 - синяя. Фары светятся ночью.
 */
export function paintVehicle(model: number, dir: number, siren = 0): Painted {
  return draw(dir / 2, 9000 + model * 10 + siren, (k) => {
    const b = k.b;
    const wheels = (xs: number, zs: number[], r: number) => {
      for (const z of zs) for (const x of [-xs, xs]) b.ellipsoid(x, r, z, 0.012, r, r, M.tyre, { seg: 7 });
    };
    if (model === 6) {
      // Броневик: длинный корпус, рубка, пулемёт, жёлто-чёрная полоса, шесть колёс, мигалка
      const body = k.tone(0x6a7650, 'along', { mottle: 0.12 });
      wheels(0.11, [-0.15, 0, 0.15], 0.04);
      b.box(0, 0.035, 0, 0.22, 0.11, 0.46, body, { inset: 0.012 });
      b.box(0, 0.145, -0.04, 0.16, 0.065, 0.2, body, { inset: 0.01 });
      b.box(0, 0.12, 0.2, 0.17, 0.035, 0.012, M.visor);
      b.capsule([0, 0.2, 0.02], [0, 0.205, 0.17], 0.012, M.metalDark, 5);
      for (let i = 0; i < 4; i++) b.box(-0.06 + i * 0.04, 0.05, 0.231, 0.04, 0.025, 0.006, i % 2 ? M.hazardDark : M.hazard);
      b.box(-0.04, 0.21, -0.1, 0.035, 0.025, 0.035, siren === 1 ? M.sirenRed : M.taillight);
      b.box(0.04, 0.21, -0.1, 0.035, 0.025, 0.035, siren === 2 ? M.sirenBlue : M.metalDark);
      for (const x of [-0.07, 0.07]) b.box(x, 0.08, 0.232, 0.03, 0.02, 0.006, M.headlight);
      return;
    }
    if (model === 5) {
      // Фургон: кремовый кузов и рыжая кабина, как у 3D-грузовика
      wheels(0.07, [-0.1, 0.1], 0.03);
      b.box(0, 0.03, -0.04, 0.15, 0.14, 0.22, k.tone(0xe6dac2, 'along', { mottle: 0.08 }), { inset: 0.006 });
      b.box(0, 0.03, 0.12, 0.14, 0.1, 0.09, k.tone(0xc06a3e, 'along'), { inset: 0.008 });
      b.box(0, 0.085, 0.165, 0.12, 0.035, 0.006, M.visor);
      for (const x of [-0.05, 0.05]) b.box(x, 0.05, 0.166, 0.025, 0.018, 0.005, M.headlight);
      return;
    }
    const paintCol = k.tone(CAR_COLORS[model] ?? 0xd8452f, 'along', { mottle: 0.05 });
    const L = model === 2 ? 0.27 : model === 0 ? 0.22 : 0.25, W = 0.12;
    wheels(W / 2, [-L * 0.32, L * 0.32], 0.028);
    b.box(0, 0.02, 0, W, 0.05, L, paintCol, { inset: 0.008 });
    // Кабина: стёкла по кругу, крыша цветом кузова
    const cl = model === 2 ? L * 0.62 : L * 0.5, cz = model === 0 ? -0.02 : -0.01;
    b.box(0, 0.07, cz, W * 0.84, 0.042, cl, M.visor, { inset: 0.012 });
    b.box(0, 0.112, cz, W * 0.72, 0.012, cl - 0.03, paintCol);
    if (model === 3) {
      b.box(0, 0.124, cz, 0.05, 0.018, 0.025, M.frame);
      for (let i = 0; i < 3; i++) b.box(-0.04 + i * 0.04, 0.05, L / 2 - 0.05, 0.02, 0.012, 0.03, M.hazardDark);
    }
    if (model === 4) {
      b.box(-0.022, 0.124, cz, 0.04, 0.016, 0.03, M.sirenRed);
      b.box(0.022, 0.124, cz, 0.04, 0.016, 0.03, M.sirenBlue);
      b.box(0, 0.045, 0, W + 0.002, 0.014, L * 0.6, k.tone(0x2f5fa8));
    }
    for (const x of [-W * 0.32, W * 0.32]) {
      b.box(x, 0.04, L / 2 + 0.002, 0.026, 0.016, 0.006, M.headlight);
      b.box(x, 0.045, -L / 2 - 0.002, 0.024, 0.014, 0.006, M.taillight);
    }
  }, { ppu: 256, brush: 1.2, shadow: 0.42 });
}
