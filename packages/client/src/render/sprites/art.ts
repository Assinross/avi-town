// Рисунки прототипа 009 по Style Bible (specs/009-painted-sprites/style-bible.md): бункер,
// мешки с песком, деревья, камни, обломки, пучки травы, бойцы и жители, плитки земли и дорог.
// Все рисуются одним кодом-художником (painter.ts) с общими палитрой и светом.

import { Blockout, fbm, hex, makeCanvas, material, mix, noise3, paint, paintFlat, rgba, rng, type Material, type Painted, type RGB } from './painter';

/** Пикселей на единицу экрана: здания и природа, люди, мелкая трава. */
export const PPU = 128;
const PPU_PEOPLE = 320;
/** Рост человека в клетках (Style Bible, 5): крупнее 3D-жителей ради читаемости. */
const PERSON_H = 0.24;
const PPU_SMALL = 256;
/** Пикселей на клетку земли и запас по краю плитки для мягкого стыка соседей. */
export const GROUND_PX = 128;
export const GROUND_OVER = 0.22;
export const GROUND_TILE = Math.round(GROUND_PX * (1 + 2 * GROUND_OVER));

// --- Материалы: свет, основа, тень (таблица 3 Style Bible) -------------------------------------
export const M = {
  concrete: 0, concreteLight: 1, mound: 2, earth: 3, metal: 4, metalDark: 5, hazard: 6, hazardDark: 7,
  apron: 8, sack: 9, leaf: 10, leaf2: 11, leafDry: 12, bark: 13, stone: 14, rust: 15, lamp: 16,
  suit: 17, visor: 18, gun: 19, skin: 20, boots: 21, pack: 22, moss: 23,
  cloth0: 24, cloth1: 25, cloth2: 26, cloth3: 27, cloth4: 28, pants: 29, hair: 30,
  frame: 31, glass: 32, door: 33, planks: 34, sand: 35, brick: 36, leafAutumn: 37, crate: 38, military: 39, ore: 40, pit: 41,
  crop0: 42, crop1: 43, crop2: 44, headlight: 45, taillight: 46, sirenRed: 47, sirenBlue: 48, tyre: 49, vest: 50,
} as const;

export const MATS: Material[] = [
  material(0xc6bba9, 0xa69a88, 0x7a6f62, 'along', { mottle: 0.22, jitter: 0.09, speck: hex(0x8a7d6a), speckRate: 0.1, streaks: 0.22 }),
  material(0xd3c9b7, 0xb5aa98, 0x857a6c, 'along', { mottle: 0.18, jitter: 0.08, streaks: 0.15 }),
  material(0xb3bf58, 0x86993e, 0x5b7031, 'up', { mottle: 0.22, jitter: 0.12, speck: hex(0xe8c547), speckRate: 0.04, patch: hex(0xc19a62), patchRate: 0.28 }),
  material(0xd9b884, 0xc19a62, 0x8f6b45, 'dab', { mottle: 0.15 }),
  material(0xa3acb2, 0x76818a, 0x515a62, 'vertical', { mottle: 0.1, speck: hex(0x9a6a45), speckRate: 0.05 }),
  material(0x5f666c, 0x464c52, 0x33383d, 'vertical', { mottle: 0.05 }),
  material(0xf0cc55, 0xdcae38, 0xa07a26, 'along', { mottle: 0.05, jitter: 0.04 }),
  material(0x55504a, 0x3f3b37, 0x2e2b28, 'along', { mottle: 0.04, jitter: 0.03 }),
  material(0xdcc08a, 0xc4a26e, 0x977a52, 'dab', { mottle: 0.2, speck: hex(0xa89c8a), speckRate: 0.06 }),
  material(0xdcc28c, 0xbf9f68, 0x8e7249, 'dab', { mottle: 0.12, stroke: 0.8 }),
  material(0x9cc25a, 0x6a9a3c, 0x3f6a2e, 'dab', { mottle: 0.18, jitter: 0.12, stroke: 1.1 }),
  material(0xb4c862, 0x86a843, 0x557a32, 'dab', { mottle: 0.18, jitter: 0.12, stroke: 1.1, speck: hex(0xd98a3a), speckRate: 0.05 }),
  material(0xc9be62, 0xa39a48, 0x6f6a34, 'dab', { mottle: 0.2, jitter: 0.12, stroke: 1.1 }),
  material(0x9a7a5a, 0x765a42, 0x523e2f, 'vertical', { mottle: 0.1 }),
  material(0xc4b8a5, 0xa2968a, 0x6f6659, 'dab', { mottle: 0.18, speck: hex(0x7f9446), speckRate: 0.07 }),
  material(0xc07a4a, 0x9a5a36, 0x6a3e27, 'dab', { mottle: 0.15 }),
  material(0xffe9b0, 0xffd98a, 0xffd98a, 'dab', { flat: true, glow: 0.02 }),
  material(0xf6d260, 0xdcac36, 0xa07624, 'along', { mottle: 0.06, jitter: 0.05 }),
  material(0x6f8a96, 0x3d4a52, 0x2c353b, 'dab', { flat: true }),
  material(0x5a5652, 0x403d3a, 0x2e2c2a, 'along', { mottle: 0.04 }),
  material(0xe8c4a0, 0xcf9f7a, 0x9a6f52, 'dab', { mottle: 0.04 }),
  material(0x6a5a4a, 0x4e4236, 0x3a3128, 'dab', { mottle: 0.04 }),
  material(0x9aa070, 0x767c52, 0x52573a, 'dab', { mottle: 0.08 }),
  material(0x93a84f, 0x6f8a3a, 0x4c6430, 'dab', { mottle: 0.15 }),
  material(0x9bbad0, 0x7d9bb0, 0x566f80, 'along', { mottle: 0.05 }),
  material(0xd0907a, 0xb0705a, 0x7d4c3d, 'along', { mottle: 0.05 }),
  material(0xa9b875, 0x8a9a5b, 0x5e6b3e, 'along', { mottle: 0.05 }),
  material(0xe0c08a, 0xc9a46a, 0x917449, 'along', { mottle: 0.05 }),
  material(0xb89ac0, 0x9a7aa0, 0x6c5473, 'along', { mottle: 0.05 }),
  material(0x6f6a62, 0x55504a, 0x3d3a36, 'along', { mottle: 0.05 }),
  material(0x7a5a40, 0x5c4230, 0x3f2d21, 'dab', { mottle: 0.05 }),
  material(0xfaf4e8, 0xe9e2d4, 0xb8ad9c, 'along', { mottle: 0.03, jitter: 0.03 }),
  material(0xd2ecf4, 0x86b4cc, 0x5a86a0, 'vertical', { mottle: 0.08, jitter: 0.05, glow: true }),
  material(0x8a6446, 0x6a4a32, 0x4a3424, 'vertical', { mottle: 0.05 }),
  material(0xc49a6a, 0xa07a52, 0x74563a, 'along', { mottle: 0.12 }),
  material(0xead9a8, 0xd8c08a, 0xa8925f, 'dab', { mottle: 0.12 }),
  material(0xc27a5e, 0xa0583f, 0x6f3c2c, 'along', { mottle: 0.14, rows: 40 }),
  material(0xe8a050, 0xd27a3c, 0x9a4e2a, 'dab', { mottle: 0.18, jitter: 0.12, stroke: 1.1, speck: hex(0xe8c547), speckRate: 0.06 }),
  material(0xd0a870, 0xb08a55, 0x7d6038, 'along', { mottle: 0.1 }),
  material(0x8a9870, 0x6a7652, 0x4a543a, 'along', { mottle: 0.08 }),
  material(0x9a8a78, 0x7a6a5a, 0x54483c, 'dab', { mottle: 0.2 }),
  material(0x4a4038, 0x342c26, 0x241e1a, 'dab', { mottle: 0.05 }),
  material(0x9cc25a, 0x6f9a3c, 0x4a6e2e, 'dab', { mottle: 0.15, jitter: 0.1 }),
  material(0xd8c45a, 0xb8a03c, 0x8a742a, 'dab', { mottle: 0.15, jitter: 0.1 }),
  material(0xb8c860, 0x8aa040, 0x5e742e, 'dab', { mottle: 0.15, jitter: 0.1, speck: hex(0xd8452f), speckRate: 0.08 }),
  material(0xfff4d0, 0xf2e6c0, 0xf2e6c0, 'dab', { flat: true, glow: 0.01 }),
  material(0xd0503a, 0xa8382a, 0x7a2a20, 'dab', { mottle: 0.02 }),
  material(0xff5a4a, 0xff3a2a, 0xff3a2a, 'dab', { flat: true }),
  material(0x5a9aff, 0x3a7aff, 0x3a7aff, 'dab', { flat: true }),
  material(0x4a4440, 0x2e2a28, 0x1e1c1a, 'dab', { mottle: 0.03 }),
  material(0xf59a45, 0xe0762c, 0xa4521e, 'along', { mottle: 0.05 }),
];

// --- Бункер ---------------------------------------------------------------------------------------
// Как на макете Avi: круглый котлован с бетонными уступами, на дне - бетонный блок с огромными
// гермоворотами и цифрой 7, к воротам от дороги спускается пандус; вокруг мачты с огнями,
// купол вентиляции и флаг. Улучшения видно снаружи.

/** Уступы котлована: радиус края (в клетках) и глубина уступа. Дно - глубже последнего. */
const PIT: [number, number][] = [[1.32, 0], [1.12, -0.18], [0.92, -0.36]];
const PIT_FLOOR = -0.54;
/** Пандус к воротам: полуширина и где начинается (у ворот) по оси к дороге. */
const RAMP_W = 0.2, RAMP_FROM = 0.42;
const smooth = (a: number, b: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Высота дна котлована в точке (x, z) бункера: уступы и пандус. */
function pitHeight(x: number, z: number): number {
  const r = Math.hypot(x, z);
  let h = PIT_FLOOR;
  for (let k = PIT.length - 1; k >= 0; k--) {
    const [rk, hk] = PIT[k];
    const below = k + 1 < PIT.length ? PIT[k + 1][1] : PIT_FLOOR;
    h = Math.max(h, below + (hk - below) * smooth(rk - 0.035, rk - 0.005, r));
  }
  if (Math.abs(x) < RAMP_W && z > RAMP_FROM) h = Math.max(h, PIT_FLOOR * (1 - Math.min(1, (z - RAMP_FROM) / (PIT[0][0] - RAMP_FROM))));
  return h;
}

/** Улучшения бункера, видимые на рисунке, - биты ключа спрайта. */
export const BUNKER_UPS = ['garage', 'command', 'medbay', 'barracks2', 'barracks3', 'armory', 'shelter'] as const;

/** Мешки с песком по бокам пандуса в координатах бункера (u вдоль фасада, f к дороге) и их поворот. */
export const BUNKER_SANDBAGS: { u: number; f: number; quarter: number }[] = [
  { u: -0.52, f: 1.38, quarter: 0 },
  { u: 0.52, f: 1.38, quarter: 0 },
];

/** Бункер 3x3, ворота к +z (rel - поворот на четверти относительно вида 0), mask - улучшения. */
export function paintBunker(rel: number, mask = 0): Painted {
  const has = (id: (typeof BUNKER_UPS)[number]) => !!(mask & (1 << BUNKER_UPS.indexOf(id)));
  const R = rng(77);
  return paint(MATS, (b) => {
    b.push(0, 0, 0, (rel * Math.PI) / 2);
    // Котлован: площадка вокруг, уступы (светлый верх, тёмная стенка), грязное дно и пандус
    b.hill(0, 0, 0, 3, 3, 56, (u, v) => pitHeight(u * 1.5, v * 1.5), (u, v) => {
      const x = u * 1.5, z = v * 1.5, r = Math.hypot(x, z);
      if (Math.abs(x) < RAMP_W && z > RAMP_FROM && r < PIT[0][0] + 0.02) return M.pants;
      if (r > PIT[0][0]) return M.concreteLight;
      for (const [rk] of PIT) if (r < rk && r > rk - 0.045) return M.concrete;
      return r < PIT[2][0] - 0.04 ? M.ore : M.concreteLight;
    });
    // Парапет с перилами по краю котлована, с проёмом пандуса
    for (let k = 0; k < 32; k++) {
      const a = (k / 32) * Math.PI * 2, x = Math.sin(a) * 1.36, z = Math.cos(a) * 1.36;
      if (z > 0 && Math.abs(x) < RAMP_W + 0.06) continue;
      b.push(x, 0, z, a);
      b.box(0, 0, 0, 0.27, 0.05, 0.05, M.concrete);
      b.box(0.12, 0.05, 0, 0.012, 0.07, 0.012, M.hazard);
      b.box(0, 0.11, 0, 0.27, 0.01, 0.01, M.hazard);
      b.pop();
    }
    // Лестницы по стенкам уступов
    for (const a of [0.9, 2.4, 3.9, 5.3]) {
      for (const [rk, hk] of PIT) {
        const x = Math.sin(a) * (rk - 0.03), z = Math.cos(a) * (rk - 0.03), y0 = hk - 0.18;
        b.push(x, 0, z, a);
        for (const s of [-0.03, 0.03]) b.box(s, y0, 0, 0.008, 0.2, 0.008, M.metal);
        for (let i = 0; i < 4; i++) b.box(0, y0 + 0.03 + i * 0.045, 0, 0.06, 0.006, 0.006, M.metal);
        b.pop();
      }
    }
    // Края пандуса: жёлто-чёрный отбойник
    for (const s of [-1, 1]) for (let i = 0; i < 8; i++) {
      const z = RAMP_FROM + 0.05 + i * 0.105, y = pitHeight(0, z);
      b.box(s * (RAMP_W + 0.01), y, z, 0.03, 0.03, 0.1, i % 2 ? M.hazardDark : M.hazard);
    }
    // Бетонный блок на дне: швы панелей, гермоворота с рёбрами, цифра 7, перила на крыше
    const by = PIT_FLOOR, bh = 0.95, bz = -0.12, bw = 1.05, bd = 0.84, front = bz + bd / 2;
    b.box(0, by, bz, bw, bh, bd, M.metal, { inset: 0.015 });
    for (let i = 1; i < 4; i++) {
      b.box(0, by + i * 0.24, front + 0.003, bw - 0.04, 0.008, 0.006, M.metalDark);
      b.box(bw / 2 + 0.003, by + i * 0.24, bz, 0.006, 0.008, bd - 0.04, M.metalDark);
    }
    for (const x of [-0.42, 0.42]) b.box(x, by, front + 0.003, 0.008, bh - 0.03, 0.006, M.metalDark);
    b.box(0, by + bh, bz, bw - 0.02, 0.05, bd - 0.03, M.concreteLight);
    b.box(0, by, front + 0.006, 0.58, 0.44, 0.012, M.pit);
    for (let i = 0; i < 6; i++) b.box(-0.225 + i * 0.09, by + 0.02, front + 0.014, 0.075, 0.38, 0.01, M.metalDark);
    b.box(0, by + 0.2, front + 0.022, 0.012, 0.2, 0.006, M.hazard);
    for (const s of [-1, 1]) {
      for (let i = 0; i < 5; i++) b.box(s * 0.32, by + i * 0.095, front + 0.01, 0.055, 0.095, 0.02, i % 2 ? M.hazardDark : M.hazard);
      b.box(s * 0.32, by + 0.5, front + 0.025, 0.05, 0.03, 0.03, M.lamp);
    }
    b.box(0, by + 0.46, front + 0.01, 0.66, 0.045, 0.024, M.hazard);
    // Цифра 7: перекладина и наклонная ножка ступеньками
    const sy = by + bh - 0.06, fz = front + 0.014;
    b.box(0.0, sy - 0.07, fz, 0.3, 0.07, 0.012, M.frame);
    for (let i = 0; i < 5; i++) b.box(0.1 - i * 0.04, sy - 0.14 - i * 0.055, fz, 0.075, 0.065, 0.012, M.frame);
    // Узкие окна-бойницы по бокам
    for (const z of [-0.4, -0.2, 0.0, 0.2]) for (const y of [by + 0.55, by + 0.78]) {
      b.box(bw / 2 + 0.006, y, z, 0.012, 0.05, 0.1, M.glass);
      b.box(-bw / 2 - 0.006, y, z, 0.012, 0.05, 0.1, M.glass);
    }
    // Трубы и лестница по стене блока
    for (const z of [-0.45, -0.38]) b.cylinder(bw / 2 + 0.03, by, z, 0.018, bh + 0.1, M.metalDark, 6);
    for (const s of [-0.04, 0.04]) b.box(-bw / 2 - 0.02, by, 0.18 + s, 0.008, bh + 0.08, 0.008, M.metal);
    for (let i = 0; i < 10; i++) b.box(-bw / 2 - 0.02, by + 0.06 + i * 0.09, 0.18, 0.008, 0.006, 0.08, M.metal);
    // Крыша блока: перила, люк, вентиляция, мачта с огнём
    const top = by + bh + 0.05;
    for (let i = 0; i <= 8; i++) {
      const x = -bw / 2 + 0.03 + (i * (bw - 0.06)) / 8;
      b.box(x, top, front - 0.02, 0.01, 0.07, 0.01, M.hazard);
      b.box(x, top, bz - bd / 2 + 0.02, 0.01, 0.07, 0.01, M.hazard);
    }
    b.box(0, top + 0.065, front - 0.02, bw - 0.06, 0.008, 0.008, M.hazard);
    b.box(0, top + 0.065, bz - bd / 2 + 0.02, bw - 0.06, 0.008, 0.008, M.hazard);
    for (const x of [-0.32, 0.3]) {
      b.box(x, top, bz - 0.15, 0.16, 0.12, 0.16, M.concrete);
      b.box(x, top + 0.12, bz - 0.15, 0.2, 0.03, 0.2, M.concreteLight, { inset: 0.02 });
      for (let k = 0; k < 3; k++) b.box(x, top + 0.02 + k * 0.032, bz - 0.15 + 0.082, 0.12, 0.01, 0.004, M.metalDark);
    }
    b.box(-0.05, top, bz + 0.1, 0.14, 0.02, 0.14, M.metalDark);
    b.cylinder(0.42, top, bz + 0.25, 0.012, 0.35, M.metal, 5);
    b.box(0.42, top + 0.35, bz + 0.25, 0.03, 0.03, 0.03, M.lamp);
    // Строительные леса у боковой стены, как на макете
    const sx = bw / 2 + 0.16;
    for (const z of [-0.45, -0.15, 0.15]) for (const x of [sx - 0.08, sx + 0.06]) b.box(x, by, z, 0.012, bh + 0.15, 0.012, M.planks);
    for (let k = 1; k <= 4; k++) b.box(sx - 0.01, by + k * 0.24, -0.15, 0.17, 0.014, 0.62, M.planks);
    // Мачты связи: решётка, раскосы, огонь на вершине
    for (const [x, z] of [[-1.05, -0.95], [1.0, -1.05]] as const) {
      b.box(x, 0, z, 0.14, 0.05, 0.14, M.concrete);
      for (const [dx, dz] of [[-0.03, -0.03], [0.03, -0.03], [0.03, 0.03], [-0.03, 0.03]]) b.capsule([x + dx * 1.6, 0.05, z + dz * 1.6], [x + dx * 0.5, 1.1, z + dz * 0.5], 0.008, M.metal, 4);
      for (let i = 1; i < 7; i++) b.box(x, 0.05 + i * 0.15, z, 0.09 - i * 0.008, 0.008, 0.09 - i * 0.008, M.metalDark);
      b.box(x, 1.12, z, 0.05, 0.04, 0.05, M.lamp);
      b.box(x + 0.06, 0.8, z, 0.08, 0.05, 0.012, M.frame);
    }
    // Купол вентиляции с решёткой, флаг, прожекторы на краю котлована
    b.cylinder(1.1, 0, 0.42, 0.22, 0.16, M.concreteLight, 16);
    b.ellipsoid(1.1, 0.16, 0.42, 0.22, 0.13, 0.22, M.concrete, { seg: 14 });
    for (let k = 0; k < 6; k++) b.box(1.1 + Math.sin(k) * 0.23, 0.04, 0.42 + Math.cos(k) * 0.23, 0.03, 0.1, 0.03, M.metalDark);
    b.box(-1.05, 0, 0.78, 0.025, 0.8, 0.025, M.metal);
    b.box(-0.95, 0.56, 0.78, 0.18, 0.22, 0.012, M.cloth0);
    b.box(-0.95, 0.66, 0.785, 0.06, 0.03, 0.006, M.frame);
    for (const a of [2.2, 3.1, 4.0]) {
      const x = Math.sin(a) * 1.42, z = Math.cos(a) * 1.42;
      b.cylinder(x, 0, z, 0.01, 0.28, M.metalDark, 5);
      b.box(x, 0.28, z, 0.06, 0.04, 0.04, M.lamp);
    }
    // Хозяйство на дне и площадке: ящики, бочки, катушка кабеля, погрузчик, генератор, контейнеры
    for (let k = 0; k < 5; k++) {
      const a = 0.4 + k * 0.33, rr = 0.74 + R() * 0.08;
      const x = Math.sin(a) * rr, z = Math.cos(a) * rr * 0.9 - 0.2;
      if (k % 2) b.cylinder(x, PIT_FLOOR, z, 0.035, 0.08, k % 4 === 1 ? M.rust : M.military, 8);
      else b.box(x, PIT_FLOOR, z, 0.08, 0.07, 0.08, M.crate);
    }
    b.cylinder(-0.7, PIT_FLOOR, 0.3, 0.06, 0.05, M.planks, 10);
    b.box(-0.55, PIT_FLOOR, 0.05, 0.12, 0.07, 0.08, M.hazard);
    b.box(-0.58, PIT_FLOOR + 0.07, 0.05, 0.05, 0.06, 0.07, M.visor);
    b.box(-0.47, PIT_FLOOR, 0.05, 0.012, 0.12, 0.06, M.metalDark);
    b.box(0.95, 0, -0.35, 0.22, 0.13, 0.14, M.military);
    b.cylinder(0.9, 0.13, -0.35, 0.012, 0.1, M.metalDark, 5);
    for (const [x, z, c] of [[-1.2, -0.15, M.rust], [-1.22, 0.15, M.cloth0]] as const) b.box(x, 0, z, 0.16, 0.14, 0.3, c);
    // Улучшения
    if (has('garage')) {
      b.box(0.58, PIT[2][1] - 0.18, 0.6, 0.3, 0.17, 0.02, M.military);
      for (let i = 0; i < 3; i++) b.box(0.58, PIT[2][1] - 0.15 + i * 0.045, 0.612, 0.27, 0.01, 0.006, M.metalDark);
    }
    if (has('command')) {
      b.box(0.15, top, bz + 0.15, 0.04, 0.25, 0.04, M.metal);
      b.ellipsoid(0.15, top + 0.27, bz + 0.15, 0.2, 0.05, 0.2, M.frame, { seg: 12 });
    }
    if (has('medbay')) {
      b.box(-0.05, top + 0.025, bz - 0.35, 0.22, 0.008, 0.07, M.sirenRed);
      b.box(-0.05, top + 0.025, bz - 0.35, 0.07, 0.008, 0.22, M.sirenRed);
    }
    if (has('barracks2')) b.box(-0.8, PIT[2][1], -0.5, 0.22, 0.18, 0.42, M.military, { top: M.moss });
    if (has('barracks3')) b.box(0.78, PIT[2][1], -0.55, 0.22, 0.18, 0.42, M.military, { top: M.moss });
    if (has('armory')) for (const [x, z] of [[0.55, 0.45], [0.66, 0.36], [0.6, 0.42]] as const) b.box(x, PIT_FLOOR, z, 0.1, 0.08, 0.1, M.crate);
    if (has('shelter')) {
      b.box(1.2, 0, -0.75, 0.3, 0.03, 0.3, M.metal);
      b.box(1.2, 0.03, -0.75, 0.22, 0.012, 0.22, M.hazard);
    }
    b.pop();
  }, { ppu: PPU, seed: 70 + rel + mask * 4, shadow: 0.4, strokes: 0.8 });
}

/** Штабель мешков: три ряда, мешки чуть разные. */
export function paintSandbags(rel: number): Painted {
  const R = rng(11);
  return paint(MATS, (b) => {
    b.push(0, 0, 0, (rel * Math.PI) / 2);
    const rows = [4, 3, 2];
    rows.forEach((n, row) => {
      for (let i = 0; i < n; i++) {
        const x = (i - (n - 1) / 2) * 0.122 + (R() - 0.5) * 0.015;
        b.ellipsoid(x, 0.032 + row * 0.058, (R() - 0.5) * 0.02 - row * 0.012, 0.066, 0.034, 0.052, M.sack, { bump: 0.14, seed: R() * 10, flatBottom: true, seg: 9 });
      }
    });
    b.pop();
  }, { ppu: PPU, seed: 20 + rel, shadow: 0.45, brush: 0.8 });
}

// --- Природа ------------------------------------------------------------------------------------------
/** Дерево: kind 0 - пышное (плодородная земля), 1 - сухое оливковое (пустошь). */
export function paintTree(kind: number, variant: number): Painted {
  const R = rng(100 + kind * 17 + variant);
  return paint(MATS, (b) => {
    if (kind === 1 && variant < 2) {
      // Сухое дерево пустоши: голый ствол и ветки, как на макете
      const h = 0.42 + R() * 0.12;
      b.capsule([0, 0, 0], [0.02, h, 0], 0.028, M.bark, 6);
      for (let i = 0; i < 5; i++) {
        const a = R() * Math.PI * 2, y = h * (0.45 + R() * 0.5), l = 0.12 + R() * 0.12;
        b.capsule([0.01, y, 0], [Math.cos(a) * l, y + 0.08 + R() * 0.1, Math.sin(a) * l], 0.011, M.bark, 4);
      }
      return;
    }
    if (kind === 0 && variant >= 4) {
      // Ель: ярусы тёмной хвои конусами
      const h = 0.62 + R() * 0.16;
      b.capsule([0, 0, 0], [0, h * 0.3, 0], 0.03, M.bark, 5);
      for (let i = 0; i < 4; i++) {
        const y = h * (0.18 + i * 0.2), r = 0.19 * (1 - i * 0.2);
        b.cylinder(0, y, 0, r, h * 0.3, M.moss, 12, r * 0.15);
      }
      return;
    }
    const k = kind === 0 ? 0.78 : 0.6;
    const h = (0.4 + R() * 0.14) * k;
    b.capsule([0, 0, 0], [0.02, h * 0.75, 0], 0.045 * k, M.bark, 6);
    b.cylinder(0, 0, 0, 0.07 * k, 0.05, M.bark, 8, 0.045 * k);
    const n = kind === 0 ? 7 : 4;
    const leaf = kind === 0 ? (variant === 3 ? M.leafAutumn : variant === 2 ? M.leaf2 : M.leaf) : M.leafDry;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + R();
      const r = i === 0 ? 0 : (0.13 + R() * 0.08) * k;
      const sz = 0.24 * k * (0.7 + R() * 0.4);
      b.ellipsoid(Math.cos(a) * r, h + (i === 0 ? 0.16 * k : R() * 0.14 * k), Math.sin(a) * r, sz, sz * 0.82, sz, i % 2 && kind === 0 && variant !== 3 ? M.leaf2 : leaf, { bump: 0.28, seed: R() * 20, seg: 12 });
    }
  }, { ppu: PPU, seed: 200 + kind * 9 + variant, shadow: 0.46, brush: 1, strokes: 1.4 });
}

export function paintRock(variant: number): Painted {
  const R = rng(300 + variant);
  return paint(MATS, (b) => {
    const n = 1 + (variant % 3);
    for (let i = 0; i < n; i++) {
      const s = 0.07 + R() * 0.08;
      b.ellipsoid((R() - 0.5) * 0.3, s * 0.45, (R() - 0.5) * 0.3, s, s * 0.7, s * 0.85, i === 0 && variant % 2 ? M.moss : M.stone, { bump: 0.25, seed: R() * 9, flatBottom: true });
    }
  }, { ppu: PPU, seed: 310 + variant, shadow: 0.4, brush: 0.8 });
}

/** Обломки: битые плиты бетона и прут арматуры. */
export function paintRubble(variant: number): Painted {
  const R = rng(400 + variant);
  return paint(MATS, (b) => {
    for (let i = 0; i < 4; i++) {
      b.push((R() - 0.5) * 0.45, 0, (R() - 0.5) * 0.45, R() * 3);
      b.box(0, 0, 0, 0.12 + R() * 0.12, 0.04 + R() * 0.06, 0.08 + R() * 0.1, i % 2 ? M.concrete : M.concreteLight, { inset: 0.012 });
      b.pop();
    }
    b.capsule([-0.1, 0.02, 0.05], [0.12, 0.13, -0.04], 0.008, M.rust, 4);
  }, { ppu: PPU, seed: 410 + variant, shadow: 0.38, brush: 0.8 });
}

/** Пучок травы: тонкие мазки снизу вверх; dry - выгоревший луг пустоши. */
export function paintTuft(variant: number, dry: boolean): Painted {
  const R = rng(500 + variant * 3 + (dry ? 1 : 0));
  const w = 34, h = 26, ax = 17, ay = 22;
  const greens: RGB[] = dry
    ? [hex(0xc9b06a), hex(0xb39a52), hex(0x9a8444), hex(0xd8c48a)]
    : [hex(0xa3c25a), hex(0x76a13d), hex(0x5d8a33), hex(0xb7cf6a)];
  return paintFlat(w, h, ax, ay, PPU_SMALL, (ctx) => {
    // Тень пучка - мягкое пятно под основанием
    ctx.fillStyle = 'rgba(59,46,31,0.22)';
    ctx.beginPath();
    ctx.ellipse(ax + 2, ay, 9, 3, 0, 0, Math.PI * 2);
    ctx.fill();
    const blades = 9 + Math.floor(R() * 6);
    for (let i = 0; i < blades; i++) {
      const bx = ax + (R() - 0.5) * 14, len = 8 + R() * 11, lean = (R() - 0.5) * 7;
      const c = greens[Math.floor(R() * greens.length)];
      ctx.strokeStyle = rgba(c, 0.85);
      ctx.lineWidth = 1.2 + R() * 1.1;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(bx, ay);
      ctx.quadraticCurveTo(bx + lean * 0.3, ay - len * 0.6, bx + lean, ay - len);
      ctx.stroke();
    }
    // Цветок изредка: жёлтый или белый
    if (variant % 3 === 0) {
      ctx.fillStyle = variant % 2 ? '#f2efe0' : '#e8c547';
      for (let k = 0; k < 2; k++) {
        ctx.beginPath();
        ctx.arc(ax + (R() - 0.5) * 10, ay - 10 - R() * 6, 1.6, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  });
}

// --- Люди -----------------------------------------------------------------------------------------------
export type PersonKind = 'soldier' | 'civ0' | 'civ1' | 'civ2' | 'worker';
export const PERSON_KINDS: PersonKind[] = ['soldier', 'civ0', 'civ1', 'civ2', 'worker'];
/** Кадры: 0 - покой, 1..4 - шаг. */
export const WALK_FRAMES = 4;
/** Длина шага в клетках: один полный цикл ходьбы (4 кадра) - два шага. */
export const STRIDE = 0.11;

/**
 * Человек ростом 0.2 клетки, смотрит в сторону dir (0..7, восьмые оборота относительно вида 0).
 * Боец - в жёлтом защитном костюме с капюшоном, тёмным визором, ранцем и автоматом;
 * житель - в одежде приглушённого цвета.
 */
export function paintPerson(kind: PersonKind, dir: number, frame: number): Painted {
  const soldier = kind === 'soldier';
  const worker = kind === 'worker';
  const cloth = soldier ? M.suit : worker ? M.vest : M.cloth0 + Number(kind.slice(3));
  const ph = frame === 0 ? 0 : ((frame - 1) / WALK_FRAMES) * Math.PI * 2;
  const swing = frame === 0 ? 0 : Math.sin(ph);
  const bob = frame === 0 ? 0 : Math.abs(Math.cos(ph)) * 0.005;
  return paint(MATS, (b) => {
    b.scale = PERSON_H / 0.2;
    b.push(0, bob, 0, (dir * Math.PI) / 4);
    const hip = 0.088;
    for (const s of [-1, 1]) {
      const fz = swing * s * 0.03;
      b.capsule([s * 0.017, hip, 0], [s * 0.018, 0.016, fz], 0.0125, soldier ? M.suit : M.pants, 6);
      b.ellipsoid(s * 0.018, 0.01, fz + 0.007, 0.012, 0.01, 0.019, M.boots, { seg: 6 });
    }
    b.ellipsoid(0, 0.125, 0, 0.031, 0.045, 0.023, cloth, { seg: 7 });
    if (soldier) {
      b.box(0, 0.1, -0.027, 0.045, 0.055, 0.02, M.pack);
      b.ellipsoid(0, 0.178, 0, 0.028, 0.027, 0.027, M.suit, { seg: 7 });
      b.ellipsoid(0, 0.176, 0.017, 0.019, 0.012, 0.012, M.visor, { seg: 6 });
      // Автомат у груди, руки к нему
      b.capsule([0.03, 0.112, -0.005], [-0.012, 0.135, 0.075], 0.0065, M.gun, 5);
      b.capsule([0.036, 0.152, 0], [0.024, 0.118, 0.03], 0.0105, M.suit, 6);
      b.capsule([-0.036, 0.152, 0], [-0.008, 0.128, 0.05], 0.0105, M.suit, 6);
    } else {
      b.ellipsoid(0, 0.176, 0, 0.024, 0.026, 0.024, M.skin, { seg: 7 });
      // Строитель: жёлтая каска с козырьком вместо волос, доска на плече
      if (worker) {
        b.ellipsoid(0, 0.19, 0, 0.028, 0.019, 0.028, M.hazard, { seg: 7 });
        b.box(0, 0.186, 0.022, 0.04, 0.005, 0.014, M.hazard);
        b.capsule([0.03, 0.17, -0.09], [0.03, 0.172, 0.09], 0.007, M.planks, 4);
      } else b.ellipsoid(0, 0.186, -0.004, 0.025, 0.017, 0.025, M.hair, { seg: 6 });
      for (const s of [-1, 1]) b.capsule([s * 0.036, 0.152, 0], [s * 0.038, 0.098, -swing * s * 0.026], 0.0095, cloth, 6);
    }
    b.pop();
  }, { ppu: PPU_PEOPLE, seed: 600 + dir * 7 + frame, shadow: 0.42, brush: 1.6, strokes: 0.6 });
}

// --- Земля -----------------------------------------------------------------------------------------------
export type Terrain = 'water' | 'rock' | 'contaminated' | 'wasteland' | 'soil' | 'yardR' | 'yardC' | 'yardI' | 'yardA';
/** Порядок наложения земли: следующие ложатся краем на предыдущие; дворы участков - поверх земли. */
export const TERRAIN_ORDER: Terrain[] = ['water', 'rock', 'contaminated', 'wasteland', 'soil', 'yardA', 'yardI', 'yardR', 'yardC'];
export const GROUND_VARIANTS = 4;

const GROUND_TONES: Record<Terrain, { light: number; base: number; shadow: number; accents: number[]; patch?: number }> = {
  wasteland: { light: 0xd8b47c, base: 0xc29a63, shadow: 0x9a744a, accents: [0xb39a5a, 0xa98a56, 0xceb27e, 0x9a8450], patch: 0xa88c58 },
  soil: { light: 0xa9bb62, base: 0x89a24c, shadow: 0x66803c, accents: [0x9ab056, 0x76923f, 0xb8b866] },
  contaminated: { light: 0xc9bd6a, base: 0xa89a52, shadow: 0x7d703c, accents: [0xb9d05a, 0x8a7e40], patch: 0x8f8048 },
  rock: { light: 0xc9bba2, base: 0xa99a84, shadow: 0x7d705e, accents: [0xb8ab98, 0x8a7f70], patch: 0x9a8f7c },
  water: { light: 0x86bccc, base: 0x5a96ad, shadow: 0x3f7690, accents: [0x6fa8bc, 0x4a86a0] },
  yardR: { light: 0xa6b464, base: 0x8a9c52, shadow: 0x6c7e42, accents: [0x98a85a, 0x7c8e4a, 0xb0a868], patch: 0xa89a66 },
  yardC: { light: 0xcfc6b4, base: 0xb9af9b, shadow: 0x9a907e, accents: [0xc4baa6, 0xaaa08c] },
  yardI: { light: 0xbab0a0, base: 0xa39a8a, shadow: 0x857c6e, accents: [0x9a9082, 0xb0a696] },
  yardA: { light: 0xb08860, base: 0x94704a, shadow: 0x6f5236, accents: [0xa07c54, 0x86643f] },
};

/** Мягкий край плитки за пределами клетки: кистевой, по шуму, а не по линейке. */
function featherEdge(img: ImageData, seed: number, sides = 15) {
  const n = GROUND_TILE, o = (n - GROUND_PX) / 2, d = img.data;
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const dx = Math.max(o - x, x - (o + GROUND_PX - 1), 0), dy = Math.max(o - y, y - (o + GROUND_PX - 1), 0);
      const side = (dx > 0 ? (x < o ? 4 : 1) : 0) | (dy > 0 ? (y < o ? 8 : 2) : 0);
      if (!side) continue;
      if ((side & sides) !== side) {
        // Сторона, где продолжается дорога: пара пикселей запаса против шва фильтрации
        if (Math.max(dx, dy) > 3) d[(y * n + x) * 4 + 3] = 0;
        continue;
      }
      const e = Math.max(dx, dy) / o;
      const k = Math.max(0, Math.min(1, (1 - e * 1.2) + (noise3(x * 0.09, y * 0.09, seed) - 0.5) * 1.5));
      d[(y * n + x) * 4 + 3] *= k * k;
    }
  }
}

/** Шум с периодом: блок 2x2 клетки земли сходится сам с собой по краям. */
function tileNoise(x: number, y: number, period: number, cells: number, seed: number): number {
  const fx = (x / period) * cells, fy = (y / period) * cells;
  const xi = Math.floor(fx), yi = Math.floor(fy), tx = fx - xi, ty = fy - yi;
  const m = (v: number) => ((v % cells) + cells) % cells;
  const h = (a: number, b: number) => {
    const s = Math.sin(m(a) * 127.1 + m(b) * 311.7 + seed * 17.3) * 43758.5453;
    return s - Math.floor(s);
  };
  const u = tx * tx * (3 - 2 * tx), v = ty * ty * (3 - 2 * ty);
  return (h(xi, yi) * (1 - u) + h(xi + 1, yi) * u) * (1 - v) + (h(xi, yi + 1) * (1 - u) + h(xi + 1, yi + 1) * u) * v;
}
const tileFbm = (x: number, y: number, P: number, seed: number) =>
  tileNoise(x, y, P, 3, seed) * 0.55 + tileNoise(x, y, P, 6, seed + 1) * 0.3 + tileNoise(x, y, P, 12, seed + 2) * 0.15;

/**
 * Плитка земли - четверть бесшовного блока 2x2 клетки: variant 0..3 - какая четверть
 * (x и z клетки по модулю 2). Соседние клетки одного типа сходятся без шва, повтор - раз в две
 * клетки, его прячут крупные пятна света в шейдере земли. Пятна тона, короткие мазки, у луга -
 * проплешины и цветы.
 */
export function paintGround(terrain: Terrain, variant: number): HTMLCanvasElement {
  const n = GROUND_TILE, o = (n - GROUND_PX) / 2, P = GROUND_PX * 2;
  const ti = TERRAIN_ORDER.indexOf(terrain);
  const R = rng(900 + ti * 31);
  const tone = GROUND_TONES[terrain];
  const light = hex(tone.light), base = hex(tone.base), shadow = hex(tone.shadow);
  // Начало окна этой четверти в координатах блока
  const ox = (variant & 1) * GROUND_PX - o, oy = (variant >> 1) * GROUND_PX - o;
  const water = terrain === 'water';
  const c = makeCanvas(n, n);
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(n, n);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const bx = x + ox, by = y + oy;
      // Вода спокойнее: узкий разброс тона, рябь даёт мазок
      const t = water ? 0.3 + tileFbm(bx, by, P, ti) * 0.35 : tileFbm(bx, by, P, ti);
      let col = t < 0.5 ? mix(shadow, base, t / 0.5) : mix(base, light, (t - 0.5) / 0.5);
      if (tone.patch) {
        const pv = tileFbm(bx, by, P, ti + 40);
        col = mix(col, hex(tone.patch), Math.max(0, Math.min(1, (pv - 0.6) / 0.05)) * 0.7);
      }
      const i = (y * n + x) * 4;
      img.data[i] = col[0] * 255; img.data[i + 1] = col[1] * 255; img.data[i + 2] = col[2] * 255; img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  // Мазок в блоке рисуется во всех копиях со сдвигом на период - край сходится с соседом
  const dab = (x: number, y: number, draw: (x: number, y: number) => void) => {
    for (const dx of [-P, 0, P]) for (const dy of [-P, 0, P]) {
      const px = x + dx - ox, py = y + dy - oy;
      if (px > -20 && py > -20 && px < n + 20 && py < n + 20) draw(px, py);
    }
  };
  // У травы мазки по диагонали плитки (на экране это вертикаль), у воды - вдоль экрана
  const palette = [light, base, shadow, ...tone.accents.map(hex)];
  for (let s = 0, count = water ? 1400 : 3400; s < count; s++) {
    const x = R() * P, y = R() * P;
    const col = water ? (R() < 0.45 ? hex(0xbfe6dc) : R() < 0.5 ? light : shadow) : palette[Math.floor(R() * palette.length)];
    const ang = water ? -Math.PI / 4 + (R() - 0.5) * 0.2 : Math.PI / 4 + (R() - 0.5) * 0.8;
    const len = water ? 5 + R() * 14 : 3 + R() * 6, wid = water ? 0.7 + R() * 0.6 : 1 + R() * 1;
    const a = water ? 0.18 + R() * 0.25 : 0.3 + R() * 0.4;
    dab(x, y, (px, py) => {
      ctx.fillStyle = rgba(col, a);
      ctx.beginPath();
      ctx.ellipse(px, py, len / 2, wid, ang, 0, Math.PI * 2);
      ctx.fill();
    });
  }
  // Узор дворов: полосы стрижки газона, швы плитки, гравий, борозды пашни
  const lines = (step: number, color: string, width: number, both: boolean) => {
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    for (let g = 0; g <= P * 2; g += step) {
      ctx.beginPath(); ctx.moveTo(g - P - ox, -oy - P); ctx.lineTo(g - P - ox, P * 2 - oy); ctx.stroke();
      if (both) { ctx.beginPath(); ctx.moveTo(-ox - P, g - P - oy); ctx.lineTo(P * 2 - ox, g - P - oy); ctx.stroke(); }
    }
  };
  if (terrain === 'yardR') {
    for (let g = 0; g < P * 2; g += 64) { ctx.fillStyle = 'rgba(255,250,220,0.04)'; ctx.fillRect(g - P - ox, -oy - P, 32, P * 3); }
  }
  if (terrain === 'yardC') lines(32, 'rgba(120,112,100,0.35)', 1, true);
  if (terrain === 'yardI') lines(64, 'rgba(100,94,86,0.3)', 1.5, true);
  if (terrain === 'yardA') {
    lines(16, 'rgba(80,55,35,0.4)', 5, false);
    lines(16, 'rgba(190,150,105,0.25)', 2, false);
  }
  if (terrain === 'soil' || terrain === 'yardR') {
    for (let k = 0; k < 22; k++) {
      const x = R() * P, y = R() * P, col = R() < 0.5 ? 'rgba(232,197,71,0.9)' : 'rgba(242,239,224,0.85)', r = 0.9 + R() * 0.7;
      dab(x, y, (px, py) => {
        ctx.fillStyle = col;
        ctx.beginPath();
        ctx.arc(px, py, r, 0, Math.PI * 2);
        ctx.fill();
      });
    }
  }
  if (terrain === 'rock' || terrain === 'wasteland') {
    for (let k = 0; k < (terrain === 'rock' ? 100 : 22); k++) {
      const x = R() * P, y = R() * P, r = 1.2 + R() * 2.6;
      dab(x, y, (px, py) => {
        ctx.fillStyle = 'rgba(111,102,89,0.45)';
        ctx.beginPath(); ctx.ellipse(px + 1, py + 1, r, r * 0.8, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = rgba(hex(0xc4b8a5), 0.9);
        ctx.beginPath(); ctx.ellipse(px, py, r, r * 0.8, 0, 0, Math.PI * 2); ctx.fill();
      });
    }
  }
  if (terrain === 'contaminated') {
    for (let k = 0; k < 10; k++) {
      const x = R() * P, y = R() * P, rx = 6 + R() * 8, ry = 4 + R() * 5, rot = R() * 3;
      dab(x, y, (px, py) => {
        ctx.fillStyle = 'rgba(201,224,90,0.5)';
        ctx.beginPath();
        ctx.ellipse(px, py, rx, ry, rot, 0, Math.PI * 2);
        ctx.fill();
      });
    }
  }
  const out = ctx.getImageData(0, 0, n, n);
  featherEdge(out, variant + ti * 10);
  ctx.putImageData(out, 0, 0);
  return c;
}

/**
 * Плитка дороги по маске связей (бит 1 - +x, 2 - +z, 4 - -x, 8 - -z, как в cityMesh), как на макете:
 * светлый тротуар с бордюром, серый асфальт, белая прерывистая ось; zebra - пешеходный переход
 * поперёк прямого участка. Полосы как у машин и пешеходов: ось машин в 0.13 от центра, тротуар - в 0.42.
 */
export function paintRoad(mask: number, zebra = false): HTMLCanvasElement {
  const n = GROUND_TILE, o = (n - GROUND_PX) / 2, P = GROUND_PX, mid = o + P / 2;
  const R = rng(1200 + mask + (zebra ? 50 : 0));
  const c = makeCanvas(n, n);
  const ctx = c.getContext('2d')!;
  const dirs = [[1, 0], [0, 1], [-1, 0], [0, -1]];
  const arms = dirs.filter((_, i) => mask & (1 << i));
  const straight = mask === 5 || mask === 10;
  // Полоса шириной 2*hw от центра к краю клетки по каждой связи плюс центральный квадрат
  const band = (hw: number, color: string) => {
    ctx.fillStyle = color;
    ctx.fillRect(mid - hw, mid - hw, hw * 2, hw * 2);
    for (const [dx, dy] of arms) {
      const x0 = dx > 0 ? mid : dx < 0 ? 0 : mid - hw, x1 = dx > 0 ? n : dx < 0 ? mid : mid + hw;
      const y0 = dy > 0 ? mid : dy < 0 ? 0 : mid - hw, y1 = dy > 0 ? n : dy < 0 ? mid : mid + hw;
      ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
    }
  };
  // Тротуар: светлая плитка со швами на всю клетку
  ctx.fillStyle = '#cbc3b3';
  ctx.fillRect(0, 0, n, n);
  for (let s = 0; s < 400; s++) {
    ctx.fillStyle = rgba([hex(0xd8d0c0), hex(0xb8b0a0), hex(0xc4bcab)][Math.floor(R() * 3)], 0.4 + R() * 0.3);
    ctx.beginPath();
    ctx.ellipse(R() * n, R() * n, 1 + R() * 2.5, 0.8 + R() * 1.2, R() * 3, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.strokeStyle = 'rgba(130,122,110,0.35)';
  ctx.lineWidth = 1;
  for (let g = 0; g <= n; g += 16) {
    ctx.beginPath(); ctx.moveTo(g, 0); ctx.lineTo(g, n); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, g); ctx.lineTo(n, g); ctx.stroke();
  }
  band(P * 0.385, '#9a9284');
  band(P * 0.37, '#706b66');
  // Фактура асфальта: крап, светлые и тёмные заплаты
  ctx.save();
  ctx.beginPath();
  ctx.rect(mid - P * 0.37, mid - P * 0.37, P * 0.74, P * 0.74);
  for (const [dx, dy] of arms) ctx.rect(dx ? (dx > 0 ? mid : 0) : mid - P * 0.37, dy ? (dy > 0 ? mid : 0) : mid - P * 0.37, dx ? n / 2 + 1 : P * 0.74, dy ? n / 2 + 1 : P * 0.74);
  ctx.clip();
  for (let s = 0; s < 700; s++) {
    ctx.fillStyle = rgba([hex(0x7d7873), hex(0x5c5853), hex(0x68635e)][Math.floor(R() * 3)], 0.35 + R() * 0.3);
    ctx.beginPath();
    ctx.ellipse(R() * n, R() * n, 0.8 + R() * 2.2, 0.6 + R(), R() * 3, 0, Math.PI * 2);
    ctx.fill();
  }
  for (let k = 0; k < 2; k++) {
    ctx.fillStyle = R() < 0.5 ? 'rgba(140,134,126,0.22)' : 'rgba(70,66,62,0.2)';
    ctx.beginPath();
    ctx.ellipse(mid + (R() - 0.5) * P * 0.6, mid + (R() - 0.5) * P * 0.6, 8 + R() * 10, 5 + R() * 6, R() * 3, 0, Math.PI * 2);
    ctx.fill();
  }
  // Разметка: белая прерывистая ось; на перекрёстке - без неё
  const junction = arms.length >= 3 || (!straight && arms.length === 2);
  if (!zebra) {
    for (const [dx, dy] of arms) {
      ctx.strokeStyle = 'rgba(236,230,214,0.85)';
      ctx.lineWidth = 2.2;
      ctx.setLineDash([9, 9]);
      ctx.beginPath();
      ctx.moveTo(mid + dx * (junction ? P * 0.37 : 0), mid + dy * (junction ? P * 0.37 : 0));
      ctx.lineTo(mid + dx * (n / 2), mid + dy * (n / 2));
      ctx.stroke();
      ctx.setLineDash([]);
    }
  } else {
    // Зебра поперёк дороги: белые полосы во всю ширину асфальта
    const along = mask === 5;
    ctx.fillStyle = 'rgba(240,236,224,0.92)';
    for (let k = -4; k <= 4; k++) {
      const t = mid + k * 10;
      if (along) ctx.fillRect(mid - P * 0.16, t - 3, P * 0.32, 6);
      else ctx.fillRect(t - 3, mid - P * 0.16, 6, P * 0.32);
    }
  }
  for (let k = 0; k < 3; k++) {
    ctx.strokeStyle = 'rgba(46,42,38,0.35)';
    ctx.lineWidth = 0.9;
    ctx.beginPath();
    let x = mid + (R() - 0.5) * P * 0.6, y = mid + (R() - 0.5) * P * 0.6;
    ctx.moveTo(x, y);
    for (let j = 0; j < 5; j++) {
      x += (R() - 0.5) * 12; y += (R() - 0.5) * 12;
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  ctx.restore();
  const out = ctx.getImageData(0, 0, n, n);
  // Мягкий край тротуара - только на сторонах без продолжения дороги
  featherEdge(out, 40 + mask, 15 & ~mask);
  ctx.putImageData(out, 0, 0);
  return c;
}
