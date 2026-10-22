import { describe, expect, it } from 'vitest';
import { aimAt, beaconLevel, sweepAngle } from '../src/render/searchlight';

describe('прожектор ПВО', () => {
  it('маячок ровно пульсирует и не мигает чаще раза в секунду', () => {
    const a = beaconLevel(0.1), b = beaconLevel(0.6), c = beaconLevel(1.1);
    expect(a).toBeGreaterThan(0);
    expect(a).toBeLessThanOrEqual(1);
    expect(Math.abs(a - b)).toBeGreaterThan(0.05);
    expect(c).toBeCloseTo(a, 5);
  });

  it('луч ходит по небу в пределах разумного сектора', () => {
    for (const t of [0, 1.7, 5.3, 11.9]) {
      const { yaw, pitch } = sweepAngle(t);
      expect(Math.abs(yaw)).toBeLessThanOrEqual(Math.PI / 3 + 1e-6);
      expect(pitch).toBeGreaterThan(0.6);
      expect(pitch).toBeLessThan(1.5);
    }
  });

  it('при тарелке луч смотрит на неё', () => {
    const { yaw, pitch } = aimAt(0, 0, 4, 3, 2.6);
    expect(yaw).toBeCloseTo(Math.atan2(4, 3), 5);
    expect(pitch).toBeCloseTo(Math.atan2(2.6, 5), 5);
  });
});
