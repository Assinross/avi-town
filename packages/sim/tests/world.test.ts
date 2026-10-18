import { describe, expect, it } from 'vitest';
import { apply, createWorld, hashWorld, tileAt } from '../src';

describe('world', () => {
  it('один сид - одна и та же карта', () => {
    expect(hashWorld(createWorld(42))).toBe(hashWorld(createWorld(42)));
    expect(hashWorld(createWorld(42))).not.toBe(hashWorld(createWorld(43)));
  });

  it('одни и те же команды дают одинаковое состояние', () => {
    const run = () => {
      const w = createWorld(7);
      for (let x = 0; x < 10; x++) apply(w, { type: 'buildRoad', x, y: 2 });
      for (let x = 0; x < 10; x++) apply(w, { type: 'placeHouse', x, y: 3 });
      return hashWorld(w);
    };
    expect(run()).toBe(run());
  });

  it('дом нельзя поставить без дороги рядом', () => {
    const w = createWorld(1);
    const t = tileAt(w, 0, 0)!;
    t.terrain = 'wasteland';
    t.object = 'none';
    tileAt(w, 1, 0)!.object = 'none';
    tileAt(w, 0, 1)!.object = 'none';
    expect(apply(w, { type: 'placeHouse', x: 0, y: 0 })).toEqual({ ok: false, reason: 'no_road' });
  });
});
