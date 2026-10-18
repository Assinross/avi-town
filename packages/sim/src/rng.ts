// Детерминированный ГСЧ xoshiro128**; состояние хранится в мире и сохраняется вместе с ним.

export type RngState = [number, number, number, number];

export function seedRng(seed: number): RngState {
  // splitmix32 для разворачивания одного числа в 4 слова состояния
  let s = seed >>> 0;
  const next = () => {
    s = (s + 0x9e3779b9) >>> 0;
    let z = s;
    z = Math.imul(z ^ (z >>> 16), 0x85ebca6b) >>> 0;
    z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35) >>> 0;
    return (z ^ (z >>> 16)) >>> 0;
  };
  return [next(), next(), next(), next()];
}

const rotl = (x: number, k: number) => ((x << k) | (x >>> (32 - k))) >>> 0;

/** Следующее 32-битное целое; меняет состояние на месте. */
export function nextU32(st: RngState): number {
  const result = Math.imul(rotl(Math.imul(st[1], 5) >>> 0, 7), 9) >>> 0;
  const t = (st[1] << 9) >>> 0;
  st[2] = (st[2] ^ st[0]) >>> 0;
  st[3] = (st[3] ^ st[1]) >>> 0;
  st[1] = (st[1] ^ st[2]) >>> 0;
  st[0] = (st[0] ^ st[3]) >>> 0;
  st[2] = (st[2] ^ t) >>> 0;
  st[3] = rotl(st[3], 11);
  return result;
}

/** Целое в диапазоне [0, n). */
export function nextInt(st: RngState, n: number): number {
  return nextU32(st) % n;
}
