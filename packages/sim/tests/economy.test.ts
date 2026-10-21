import { ECONOMY } from '@avi/data';
import { describe, expect, it } from 'vitest';
import {
  applyCommand, cityEnv, createWorld, deserialize, fitLot, maxLevel, serialize, setLot, step, TICKS_PER_DAY, tileAt,
  type WeekReport, type World,
} from '../src';

/** Расчищенная плодородная полоса 0..15 x 0..10, улица по y = 2, генератор и насос в левом углу. */
function town(seed = 21) {
  const w = createWorld(seed);
  for (let x = 0; x < 16; x++) {
    for (let y = 0; y <= 10; y++) Object.assign(tileAt(w, x, y)!, { terrain: 'soil', object: 'none', zone: null, level: 0, root: -1, def: null });
  }
  for (let x = 0; x < 16; x++) applyCommand(w, { type: 'buildRoad', x, y: 2 });
  applyCommand(w, { type: 'placeBuilding', def: 'plant', x: 0, y: 0 });
  applyCommand(w, { type: 'placeBuilding', def: 'pump', x: 2, y: 1 });
  w.nextRaidDay = 100000;
  return w;
}

const days = (w: World, n: number) => step(w, TICKS_PER_DAY * n);

/** Сколько дней осталось до первого дня следующей недели (день 8, 15, 22...). */
const daysToClose = (w: World) => 7 - ((w.day - 1) % 7);

/** Прокрутить до начала следующей недели и вернуть её отчёт. */
function closeWeek(w: World): WeekReport {
  days(w, daysToClose(w));
  const e = w.events.filter((x) => x.type === 'weekReport').pop();
  if (!e || e.type !== 'weekReport') throw new Error('нет отчёта');
  w.events = [];
  return e.report;
}

const sum = (o: Record<string, number>) => Object.values(o).reduce((a, b) => a + b, 0);

describe('недельный бюджет', () => {
  it('казна меняется в первый день новой недели, статьи отчёта сходятся с изменением казны', () => {
    const w = town();
    applyCommand(w, { type: 'zone', rect: { x0: 4, y0: 3, x1: 15, y1: 3 }, zone: 'R' });
    applyCommand(w, { type: 'zone', rect: { x0: 4, y0: 1, x1: 15, y1: 1 }, zone: 'C' });
    const start = w.money;
    days(w, 6); // день 7 - последний перед закрытием недели
    expect(w.day).toBe(7);
    expect(w.money).toBe(start);
    const r = closeWeek(w);
    expect(w.day).toBe(8);
    expect(r.week).toBe(1);
    expect(r.net).toBe(sum(r.income) - sum(r.expense));
    expect(w.money).toBe(start + r.net);
    expect(r.expense.buildings).toBeGreaterThan(0);
    expect(w.budget.last).toEqual(r);
    expect(sum(w.budget.income) + sum(w.budget.expense)).toBe(0);
  });

  it('неделя закрывается ровно раз в 7 дней, следующий отчёт - на 15-й день', () => {
    const w = town();
    closeWeek(w);
    expect(w.day).toBe(8);
    const reports = w.events.filter((e) => e.type === 'weekReport').length;
    expect(reports).toBe(0);
    const r = closeWeek(w);
    expect(w.day).toBe(15);
    expect(r.week).toBe(2);
  });

  it('высокий налог даёт больше денег и снижает довольство', () => {
    const w = town();
    applyCommand(w, { type: 'zone', rect: { x0: 4, y0: 3, x1: 15, y1: 3 }, zone: 'R' });
    applyCommand(w, { type: 'zone', rect: { x0: 4, y0: 1, x1: 9, y1: 1 }, zone: 'C' });
    applyCommand(w, { type: 'zone', rect: { x0: 10, y0: 1, x1: 15, y1: 1 }, zone: 'A' });
    days(w, 60);
    const res = deserialize(serialize(w));
    if (!res.ok) throw new Error('load');
    const high = res.world;
    expect(applyCommand(high, { type: 'setTax', rate: 15 }).ok).toBe(true);
    // Недельные суммы маленькие и округляются вниз - сравниваем доход за 4 недели
    const tax = (world: World) => {
      let total = 0;
      for (let i = 0; i < 4; i++) {
        const r = closeWeek(world);
        total += r.income.taxR + r.income.taxC;
      }
      return total;
    };
    const low = tax(w), hi = tax(high);
    expect(hi).toBeGreaterThan(low * 1.3);
    expect(w.stats.happiness - high.stats.happiness).toBeGreaterThanOrEqual(10);
  });

  it('ставка налога ограничена диапазоном', () => {
    const w = town();
    applyCommand(w, { type: 'setTax', rate: 99 });
    expect(w.budget.tax).toBe(ECONOMY.tax.max);
    applyCommand(w, { type: 'setTax', rate: -5 });
    expect(w.budget.tax).toBe(ECONOMY.tax.min);
  });

  it('излишки металла сверх склада продаются в конце недели', () => {
    const w = town();
    days(w, 3);
    w.resources.metal = ECONOMY.metal.storage + 500;
    const r = closeWeek(w);
    expect(w.resources.metal).toBe(ECONOMY.metal.storage);
    expect(r.income.metal).toBe(500 * ECONOMY.metal.price);
  });
});

describe('банкротство', () => {
  it('в долг строить нельзя, сносить можно', () => {
    const w = town();
    w.money = -100;
    expect(applyCommand(w, { type: 'buildRoad', x: 5, y: 6 })).toEqual({ ok: false, reason: 'no_money' });
    expect(applyCommand(w, { type: 'zone', rect: { x0: 4, y0: 3, x1: 6, y1: 3 }, zone: 'R' })).toEqual({ ok: false, reason: 'no_money' });
    expect(applyCommand(w, { type: 'bulldoze', rect: { x0: 15, y0: 2, x1: 15, y1: 2 } }).ok).toBe(true);
    expect(w.money).toBe(-100);
    expect(tileAt(w, 15, 2)!.object).toBe('none');
  });

  it('на долг начисляются проценты, 12 недель долга сверх предела - конец игры', () => {
    const w = town();
    w.money = -ECONOMY.debt.limit - 1000;
    const r1 = closeWeek(w);
    expect(r1.expense.interest).toBeGreaterThan(0);
    expect(r1.debtWeeks).toBe(1);
    let last = r1;
    for (let i = 2; i < ECONOMY.debt.weeks; i++) last = closeWeek(w);
    expect(w.over).toBeNull();
    expect(last.debtWeeks).toBe(ECONOMY.debt.weeks - 1);
    const r = closeWeek(w);
    expect(r.debtWeeks).toBe(ECONOMY.debt.weeks);
    expect(w.over).toBe('bankrupt');
    expect(w.speed).toBe(0);
    const day = w.day;
    expect(days(w, 5)).toBe(0);
    expect(w.day).toBe(day);
    expect(applyCommand(w, { type: 'setTax', rate: 12 })).toEqual({ ok: false, reason: 'game_over' });
  });

  it('неделя без долга сверх предела сбрасывает счётчик', () => {
    const w = town();
    w.money = -ECONOMY.debt.limit - 1000;
    closeWeek(w);
    closeWeek(w);
    expect(w.budget.debtWeeks).toBe(2);
    w.money = 20000;
    closeWeek(w);
    expect(w.budget.debtWeeks).toBe(0);
    expect(w.over).toBeNull();
  });
});

describe('занятость, услуги, загрязнение', () => {
  it('жители без рабочих мест не платят налог и недовольны', () => {
    const w = town();
    applyCommand(w, { type: 'zone', rect: { x0: 6, y0: 3, x1: 15, y1: 3 }, zone: 'R' });
    days(w, 14); // дома успевают встать
    const r = closeWeek(w);
    expect(w.stats.population).toBeGreaterThan(0);
    expect(w.stats.unemployment).toBe(100);
    expect(r.income.taxR).toBe(0);
    expect(r.expense.services).toBeGreaterThan(0);
    expect(w.stats.happiness).toBeLessThanOrEqual(ECONOMY.happiness.base - ECONOMY.happiness.unemploymentMax);
  });

  it('дом растёт до 3 уровня только рядом со школой и лазаретом', () => {
    const w = town();
    w.money = 100000;
    w.resources.metal = 500;
    applyCommand(w, { type: 'zone', rect: { x0: 8, y0: 3, x1: 15, y1: 3 }, zone: 'R' });
    days(w, 10);
    const x = 12, y = 3;
    const t = tileAt(w, x, y)!;
    w.stats.happiness = 70;
    expect(t.watered && t.powered).toBe(true);
    expect(maxLevel(w, t, x, y, true)).toBe(2);
    applyCommand(w, { type: 'placeBuilding', def: 'school', x: 8, y: 0 });
    expect(maxLevel(w, t, x, y, true)).toBe(2); // одной школы мало
    applyCommand(w, { type: 'placeBuilding', def: 'clinic', x: 11, y: 0 });
    days(w, 8);
    w.stats.happiness = 70;
    expect(cityEnv(w).serviced[y * w.size + x]).toBe(1);
    expect(maxLevel(w, t, x, y, true)).toBe(3);
  });

  it('жильё у генератора не выше 1 уровня, ферма в загрязнении даёт вдвое меньше еды', () => {
    const w = town();
    applyCommand(w, { type: 'zone', rect: { x0: 3, y0: 3, x1: 3, y1: 3 }, zone: 'R' });
    days(w, 8); // генератор достраивается
    const t = tileAt(w, 3, 3)!;
    w.stats.happiness = 70;
    expect(cityEnv(w).polluted[3 * w.size + 3]).toBe(1);
    expect(maxLevel(w, t, 3, 3, true)).toBe(1);

    const food = (x: number) => {
      const f = town();
      applyCommand(f, { type: 'zone', rect: { x0: x, y0: 1, x1: x, y1: 1 }, zone: 'A' });
      Object.assign(tileAt(f, x, 1)!, { level: 2, build: 0 });
      days(f, 1);
      return f.stats.foodProd;
    };
    expect(food(4)).toBe(Math.floor((food(14) * ECONOMY.pollution.farmFood) / 100));
  });

  it('промзона 3 уровня навсегда отравляет землю рядом', () => {
    const chance = ECONOMY.pollution.poisonChance;
    ECONOMY.pollution.poisonChance = 1;
    try {
      const w = town();
      applyCommand(w, { type: 'zone', rect: { x0: 10, y0: 3, x1: 10, y1: 3 }, zone: 'I' });
      Object.assign(tileAt(w, 10, 3)!, { level: 3, build: 0 });
      days(w, 3);
      const toxic = () => w.tiles.filter((t) => t.terrain === 'contaminated').length;
      const before = toxic();
      days(w, 10);
      expect(toxic()).toBeGreaterThan(before);
      expect(tileAt(w, 10, 2)!.object).toBe('road'); // дороги не трогает
      const after = toxic();
      applyCommand(w, { type: 'bulldoze', rect: { x0: 10, y0: 3, x1: 10, y1: 3 } });
      days(w, 5);
      expect(toxic()).toBe(after);
    } finally {
      ECONOMY.pollution.poisonChance = chance;
    }
  });

  it('больший дом вытесняет соседний дом ниже уровнем, но не равный', () => {
    const w = town();
    applyCommand(w, { type: 'zone', rect: { x0: 6, y0: 3, x1: 8, y1: 4 }, zone: 'R' });
    const root = (x: number) => 3 * w.size + x;
    for (const x of [6, 7, 8]) {
      const fit = fitLot(w, root(x), 2)!;
      setLot(w, root(x), 2, 0, fit.s, fit.cells);
    }
    const grow = fitLot(w, root(6), 3)!;
    expect(grow.cells).toContain(root(7));
    setLot(w, root(6), 3, 0, grow.s, grow.cells);
    expect(tileAt(w, 7, 3)!.root).toBe(root(6));
    // Справа край зоны, слева дом того же 3-го уровня - расти некуда
    expect(fitLot(w, root(8), 3)).toBeNull();
  });
});

describe('сохранение', () => {
  it('старое сохранение получает бюджет по умолчанию, деньги как были', () => {
    const w = town();
    w.money = 777;
    const file = JSON.parse(serialize(w));
    file.saveVersion = 8;
    delete file.world.budget;
    delete file.world.over;
    const res = deserialize(JSON.stringify(file));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.world.money).toBe(777);
    expect(res.world.budget.tax).toBe(ECONOMY.tax.default);
    expect(res.world.budget.debtWeeks).toBe(0);
    expect(res.world.over).toBeNull();
  });

  it('сохранение с месячным бюджетом переносится на недельный без потери денег', () => {
    const w = town();
    w.money = 999;
    const file = JSON.parse(serialize(w));
    file.saveVersion = 9;
    file.world.budget = {
      tax: 14, income: { taxR: 500, taxC: 0, taxI: 0, taxA: 0, metal: 0 },
      expense: { buildings: 100, defense: 0, services: 0, roads: 0, squad: 0, interest: 0 },
      debtMonths: 2, last: null,
    };
    const res = deserialize(JSON.stringify(file));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.world.money).toBe(999);
    expect(res.world.budget.tax).toBe(ECONOMY.tax.default);
    expect(res.world.budget.debtWeeks).toBe(0);
    expect(res.world.budget.last).toBeNull();
  });
});
