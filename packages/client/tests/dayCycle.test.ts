import { describe, expect, it } from 'vitest';
import { CYCLE_SECONDS, DayCycle, phaseAt, skyAt } from '../src/render/dayCycle';

describe('видимые сутки', () => {
  it('есть рассвет, день, вечер и ночь', () => {
    expect(phaseAt(6)).toBe('dawn');
    expect(phaseAt(12)).toBe('day');
    expect(phaseAt(19)).toBe('evening');
    expect(phaseAt(2)).toBe('night');
    expect(phaseAt(23)).toBe('night');
  });
  it('днём светло, ночью темно, на вечере и рассвете - тёплый свет', () => {
    expect(skyAt(12)).toEqual([0, 0]);
    expect(skyAt(1)[0]).toBe(1);
    expect(skyAt(19.5)[1]).toBe(1);
    expect(skyAt(6.5)[1]).toBe(1);
    expect(skyAt(20)[0]).toBeGreaterThan(0);
    expect(skyAt(20)[0]).toBeLessThan(1);
  });
  it('круг на x1 длится CYCLE_SECONDS и не зависит от игровых дней', () => {
    const c = new DayCycle();
    // Шаг сверх круга: дробные доли не дают попасть ровно в 6:00
    for (let i = 0; i <= CYCLE_SECONDS * 10; i++) c.advance(0.1, 1);
    expect(c.hour).toBeCloseTo(6, 1);
    expect(c.index).toBe(1);
  });
  it('на паузе время стоит', () => {
    const c = new DayCycle();
    c.advance(10, 0);
    expect(c.hour).toBe(6);
  });
  it('новые сутки начинаются в 6 утра, а не в полночь', () => {
    const c = new DayCycle();
    c.set(23.9);
    c.advance(CYCLE_SECONDS / 24 * 0.2, 1);
    expect(c.index).toBe(0);
    c.set(5.9);
    c.advance(CYCLE_SECONDS / 24 * 0.2, 1);
    expect(c.index).toBe(1);
  });
});
