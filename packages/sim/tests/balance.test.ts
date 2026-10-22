import { describe, expect, it } from 'vitest';
import { applyCommand, createWorld, step, TICKS_PER_DAY, tileAt, type World } from '../src';

/** Городок 40x40: улицы через каждые 5 клеток, ряд жилья, торговли, промзоны и ферм, завод и насос. */
function town(services = false) {
  const w = createWorld(7, 40);
  w.money = 500000;
  for (let x = 1; x < 39; x++) {
    for (let y = 1; y < 34; y++) {
      Object.assign(tileAt(w, x, y)!, { terrain: 'soil', object: 'none', zone: null, level: 0, root: -1, def: null });
    }
  }
  for (let y = 3; y < 33; y += 5) for (let x = 1; x < 39; x++) applyCommand(w, { type: 'buildRoad', x, y });
  for (let x = 13; x < 39; x += 12) for (let y = 3; y < 33; y++) applyCommand(w, { type: 'buildRoad', x, y });
  const zone = (x0: number, x1: number, y: number, z: 'R' | 'C' | 'I' | 'A') => {
    for (let x = x0; x <= x1; x++) {
      if (tileAt(w, x, y)!.object !== 'road') applyCommand(w, { type: 'zone', rect: { x0: x, y0: y, x1: x, y1: y }, zone: z });
    }
  };
  for (let y = 3; y < 33; y += 5) {
    zone(4, 21, y + 1, 'R');
    zone(22, 27, y + 1, 'C');
    zone(28, 32, y + 1, 'I');
    zone(33, 37, y + 1, 'A');
  }
  applyCommand(w, { type: 'placeBuilding', def: 'plant', x: 2, y: 1 });
  applyCommand(w, { type: 'placeBuilding', def: 'pump', x: 14, y: 1 });
  if (services) {
    applyCommand(w, { type: 'placeBuilding', def: 'school', x: 22, y: 1 });
    applyCommand(w, { type: 'placeBuilding', def: 'clinic', x: 30, y: 1 });
  }
  w.nextRaidDay = 100000;
  return w;
}

interface Week { pop: number; net: number; income: number; expense: number }

/** Прокрутить n недель, вернуть недельные итоги. */
function run(w: World, weeks: number): Week[] {
  const out: Week[] = [];
  for (let i = 0; i < weeks; i++) {
    step(w, TICKS_PER_DAY * (7 - ((w.day - 1) % 7)));
    const r = w.budget.last!;
    out.push({
      pop: w.stats.population,
      net: r.net,
      income: Object.values(r.income).reduce((a, b) => a + b, 0),
      expense: Object.values(r.expense).reduce((a, b) => a + b, 0),
    });
  }
  return out;
}

describe('баланс города', () => {
  it('старт без жителей не сжигает казну: неделя содержания дешевле 120 ¢', () => {
    const first = run(town(), 1)[0];
    expect(first.pop).toBe(0);
    expect(first.net).toBeGreaterThanOrEqual(-120);
  });

  it('маленький город на 100-300 жителей сводит неделю примерно в ноль', () => {
    const small = run(town(), 8).find((x) => x.pop >= 100);
    expect(small).toBeDefined();
    expect(small!.pop).toBeLessThanOrEqual(300);
    expect(small!.net).toBeGreaterThanOrEqual(-120);
  });

  it('выросший город с торговлей и промзоной приносит прибыль', () => {
    const big = run(town(), 20).filter((x) => x.pop >= 600).pop();
    expect(big).toBeDefined();
    expect(big!.net).toBeGreaterThanOrEqual(100);
  });

  it('город со школой и лазаретом не уходит в минус, когда дорастает', () => {
    const big = run(town(true), 20).filter((x) => x.pop >= 700).pop();
    expect(big).toBeDefined();
    expect(big!.net).toBeGreaterThanOrEqual(0);
  });
});
