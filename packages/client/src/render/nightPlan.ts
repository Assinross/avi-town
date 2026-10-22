// Когда и что горит в городе ночью: чистая логика без Three.js.
// По часу суток и отпечатку окна решает, горит ли огонь; всё детерминировано,
// чтобы ночная картина повторялась после перезагрузки. Решения - спека 006.

export type LightKind =
  | 'window' | 'tv' | 'shopwindow' | 'sign' | 'garland'
  | 'lamp' | 'worklight' | 'fire' | 'beacon' | 'lab' | 'workshop';

/** Один источник огня на карте: якорь собирается при сборке участка. */
export interface LightAnchor {
  kind: LightKind;
  /** Центр огня в мировых координатах. */
  x: number;
  y: number;
  z: number;
  /** Поворот фасада вокруг Y, радианы. */
  rot: number;
  /** Отпечаток клетки и окна: даёт устойчивый характер окна. */
  seed: number;
  color: number;
  w: number;
  h: number;
  /** Уровень дома 1..3 (для окон), иначе 0. */
  level: number;
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const ramp = (v: number, a: number, b: number) => clamp01((v - a) / (b - a));

/** Детерминированное 0..1 из числа - как rnd в cityMesh. */
export function hash01(i: number): number {
  const s = Math.sin(i * 12.9898) * 43758.5453;
  return s - Math.floor(s);
}

/** Час попадает в промежуток от from до to, в том числе через полночь. */
function between(hour: number, from: number, to: number): boolean {
  return from < to ? hour >= from && hour < to : hour >= from || hour < to;
}

/** Множитель доли горящих окон по уровню дома: пустой и стройка не светятся. */
function levelFactor(level: number): number {
  if (level <= 0) return 0;
  if (level >= 3) return 1;
  return level === 2 ? 0.95 : 0.9;
}

/**
 * Доля горящих окон жилья по часу суток.
 * Вечером зажигается с 17 до 20 (до 0.75), к полуночи половина, к 2 ночи 0.2, к 4:45 - ничего.
 */
export function litFraction(hour: number, level: number): number {
  const k = levelFactor(level);
  if (k === 0) return 0;
  let f: number;
  if (hour >= 17 && hour < 20) f = 0.75 * ramp(hour, 17, 20);
  else if (hour >= 20) f = 0.75 - 0.25 * ramp(hour, 20, 24);
  else if (hour < 2) f = 0.5 - 0.3 * ramp(hour, 0, 2);
  else if (hour < 4.75) f = 0.2 * (1 - ramp(hour, 2, 4.75));
  else f = 0;
  return f * k;
}

/**
 * Горит ли огонь в этот час: 1 - да, 0 - нет.
 * Фонари сюда не входят - они включаются по темноте (dark) в слое огней.
 */
export function lightLevel(kind: LightKind, seed: number, hour: number, level: number): number {
  switch (kind) {
    case 'window':
      return hash01(seed) < litFraction(hour, level) ? 1 : 0;
    case 'tv':
      // Телевизор горит всю ночь, но только в жилом доме
      return level > 0 && between(hour, 18, 4.75) ? 1 : 0;
    case 'shopwindow':
    case 'sign':
    case 'garland': {
      // Магазины закрываются по-разному: с 2 до 3:30 ночи
      const close = 2 + hash01(seed * 7.31) * 1.5;
      return between(hour, 18, close) ? 1 : 0;
    }
    case 'worklight':
    case 'fire':
    case 'beacon':
    case 'lab':
      // Дежурная смена, огонь у ворот, маячки и лаборатория - всю ночь
      return between(hour, 17, 6) ? 1 : 0;
    case 'workshop':
      return between(hour, 17, 24) ? 1 : 0;
    case 'lamp':
      return 0;
  }
}

/**
 * Сетка окон на фасаде шириной 2*hw и высотой h - для зданий, у которых нет
 * своей геометрии окон (модели Kenney). Окна не выходят за границы фасада.
 */
export function windowGrid(hw: number, h: number, floors: number): { x: number; y: number; w: number; h: number }[] {
  const W = 0.09, H = 0.12, GAP = 0.16, FLOOR_STEP = 0.34, FIRST = 0.45;
  const out: { x: number; y: number; w: number; h: number }[] = [];
  if (floors <= 0 || h < FIRST + H / 2) return out;
  const cols = Math.max(1, Math.floor((hw * 2 - W) / GAP) + 1);
  const startX = -((cols - 1) * GAP) / 2;
  for (let f = 0; f < floors; f++) {
    const y = Math.min(h - H / 2, FIRST + f * FLOOR_STEP);
    if (y - H / 2 < 0.05) continue;
    for (let i = 0; i < cols; i++) {
      const x = startX + i * GAP;
      if (Math.abs(x) + W / 2 > hw + 1e-6) continue;
      out.push({ x, y, w: W, h: H });
    }
  }
  return out;
}
