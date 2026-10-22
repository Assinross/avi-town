// Расписание ночных огней проверяется без браузера: чистая логика по часу суток.

import { describe, expect, it } from 'vitest';
import { hash01, lightLevel, litFraction, windowGrid } from '../src/render/nightPlan';

describe('расписание ночи', () => {
  it('в полдень не горит ничего', () => {
    expect(litFraction(12, 3)).toBe(0);
    expect(lightLevel('window', 0.1, 12, 2)).toBe(0);
    expect(lightLevel('shopwindow', 0.1, 12, 0)).toBe(0);
  });

  it('вечером горит больше, чем глубокой ночью', () => {
    expect(litFraction(21, 2)).toBeGreaterThan(litFraction(3, 2));
  });

  it('к 5 утра всё погашено, кроме дежурных огней', () => {
    expect(litFraction(4.9, 3)).toBe(0);
    expect(lightLevel('worklight', 0.5, 4.5, 0)).toBe(1);
    expect(lightLevel('fire', 0.5, 3, 0)).toBe(1);
  });

  it('число горящих окон растёт с уровнем дома', () => {
    expect(litFraction(21, 3)).toBeGreaterThan(litFraction(21, 1));
    expect(litFraction(21, 1)).toBeGreaterThan(0);
  });

  it('к полуночи горит примерно половина', () => {
    const f = litFraction(0, 3);
    expect(f).toBeGreaterThanOrEqual(0.35);
    expect(f).toBeLessThanOrEqual(0.7);
  });

  it('пустой дом и стройка не светятся', () => {
    expect(litFraction(22, 0)).toBe(0);
    expect(lightLevel('window', 0.1, 22, 0)).toBe(0);
    expect(lightLevel('tv', 0.1, 22, 0)).toBe(0);
  });

  it('ответ детерминирован', () => {
    expect(lightLevel('window', 0.42, 22, 2)).toBe(lightLevel('window', 0.42, 22, 2));
    expect(hash01(7)).toBe(hash01(7));
    expect(hash01(7)).toBeGreaterThanOrEqual(0);
    expect(hash01(7)).toBeLessThan(1);
  });

  it('витрины гаснут после 2-3 ночи, но не у всех', () => {
    expect(lightLevel('shopwindow', 0.9, 20, 0)).toBe(1);
    expect(lightLevel('shopwindow', 0.9, 4, 0)).toBe(0);
  });

  it('телевизор горит дольше всех окон', () => {
    expect(lightLevel('window', 0.5, 3, 2)).toBe(0);
    expect(lightLevel('tv', 0.5, 3, 2)).toBe(1);
  });

  it('дежурный свет промзоны горит всю ночь, днём нет', () => {
    expect(lightLevel('worklight', 0.5, 2, 0)).toBe(1);
    expect(lightLevel('worklight', 0.5, 14, 0)).toBe(0);
    expect(lightLevel('lab', 0.5, 23, 0)).toBe(1);
  });

  it('фонари по расписанию не выключаются - ими правит темнота', () => {
    expect(lightLevel('lamp', 0.5, 23, 0)).toBe(0);
  });
});

describe('сетка окон для моделей без своей геометрии', () => {
  it('окна не выходят за фасад', () => {
    const cells = windowGrid(0.4, 1.2, 3);
    expect(cells.length).toBeGreaterThan(2);
    for (const c of cells) {
      expect(Math.abs(c.x) + c.w / 2).toBeLessThanOrEqual(0.4 + 1e-6);
      expect(c.y - c.h / 2).toBeGreaterThanOrEqual(0);
      expect(c.y + c.h / 2).toBeLessThanOrEqual(1.2 + 1e-6);
    }
  });

  it('на большем доме окон больше', () => {
    expect(windowGrid(0.4, 1.2, 3).length).toBeGreaterThan(windowGrid(0.4, 1.2, 1).length);
  });

  it('низкий дом без места под окна не даёт ни одного', () => {
    expect(windowGrid(0.4, 0.3, 2)).toHaveLength(0);
  });
});
