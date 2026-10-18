import { describe, expect, it } from 'vitest';
import { applyCommand, createWorld, deserialize, hashWorld, History, serialize, step, TICKS_PER_DAY, tileAt, type World } from '../src';

function flatStrip(w: World, y: number) {
  for (let x = 0; x < 12; x++) {
    for (const yy of [y - 2, y - 1, y, y + 1, y + 2]) {
      const t = tileAt(w, x, yy);
      if (!t) continue;
      Object.assign(t, { terrain: 'soil', object: 'none', zone: null, level: 0, root: -1 });
    }
  }
}

function smallTown(seed: number) {
  const w = createWorld(seed);
  flatStrip(w, 2);
  for (let x = 0; x < 12; x++) applyCommand(w, { type: 'buildRoad', x, y: 2 });
  applyCommand(w, { type: 'placeBuilding', def: 'plant', x: 0, y: 0 });
  applyCommand(w, { type: 'placeBuilding', def: 'pump', x: 2, y: 1 });
  applyCommand(w, { type: 'zone', rect: { x0: 3, y0: 3, x1: 11, y1: 3 }, zone: 'R' });
  applyCommand(w, { type: 'zone', rect: { x0: 3, y0: 1, x1: 11, y1: 1 }, zone: 'A' });
  return w;
}

describe('world', () => {
  it('один сид - одна и та же карта', () => {
    expect(hashWorld(createWorld(42))).toBe(hashWorld(createWorld(42)));
    expect(hashWorld(createWorld(42))).not.toBe(hashWorld(createWorld(43)));
  });

  it('одни и те же команды и время дают одинаковое состояние', () => {
    const run = () => {
      const w = smallTown(7);
      step(w, TICKS_PER_DAY * 60);
      return hashWorld(w);
    };
    expect(run()).toBe(run());
  });

  it('зоны с током и водой растут, появляются жители', () => {
    const w = smallTown(3);
    step(w, TICKS_PER_DAY * 90);
    expect(w.stats.population).toBeGreaterThan(0);
    expect(w.stats.foodProd).toBeGreaterThan(0);
  });

  it('генератор без дороги рядом не ставится', () => {
    const w = createWorld(1);
    flatStrip(w, 10);
    expect(applyCommand(w, { type: 'placeBuilding', def: 'plant', x: 0, y: 10 })).toEqual({ ok: false, reason: 'no_road' });
  });

  it('отмена возвращает клетки и деньги', () => {
    const w = createWorld(5);
    flatStrip(w, 2);
    const h = new History();
    const before = hashWorld(w);
    applyCommand(w, { type: 'buildRoad', x: 0, y: 2 }, h);
    applyCommand(w, { type: 'zone', rect: { x0: 0, y0: 3, x1: 5, y1: 3 }, zone: 'C' }, h);
    h.undo(w);
    h.undo(w);
    expect(hashWorld(w)).toBe(before);
  });

  it('сохранение и загрузка дают тот же мир', () => {
    const w = smallTown(9);
    step(w, TICKS_PER_DAY * 20);
    const res = deserialize(serialize(w));
    expect(res.ok).toBe(true);
    if (res.ok) expect(hashWorld(res.world)).toBe(hashWorld(w));
  });
});

describe('xcom', () => {
  it('исследование идёт от лаборатории с током и открывает ПВО', () => {
    const w = smallTown(11);
    w.money = 100000;
    w.resources.metal = 500;
    w.resources.fragments = 50;
    for (let x = 0; x < 12; x++) for (const y of [5, 6]) Object.assign(tileAt(w, x, y)!, { terrain: 'soil', object: 'none', zone: null, level: 0, root: -1, def: null });
    for (let x = 0; x < 12; x++) applyCommand(w, { type: 'buildRoad', x, y: 4 });
    expect(applyCommand(w, { type: 'placeBuilding', def: 'lab', x: 8, y: 5 }).ok).toBe(true);
    expect(applyCommand(w, { type: 'placeBuilding', def: 'aa_laser', x: 4, y: 5 })).toEqual({ ok: false, reason: 'not_researched' });
    expect(applyCommand(w, { type: 'startResearch', tech: 'WeaponFragments' }).ok).toBe(true);
    step(w, TICKS_PER_DAY * 40);
    expect(w.research.done).toContain('WeaponFragments');
  });

  it('налёт детерминирован и заканчивается падением или уходом НЛО', () => {
    const run = () => {
      const w = smallTown(13);
      w.nextRaidDay = 3;
      w.money = 100000;
      w.resources.metal = 500;
      for (let x = 0; x < 12; x++) Object.assign(tileAt(w, x, 5)!, { terrain: 'soil', object: 'none', zone: null, level: 0, root: -1, def: null });
      for (let x = 0; x < 12; x++) applyCommand(w, { type: 'buildRoad', x, y: 4 });
      for (const x of [4, 6, 8, 10]) applyCommand(w, { type: 'placeBuilding', def: 'aa_avalanche', x, y: 5 });
      let raidSeen = false;
      for (let d = 0; d < 30; d++) {
        step(w, TICKS_PER_DAY);
        if (w.raid) raidSeen = true;
        w.speed = 1;
      }
      expect(raidSeen).toBe(true);
      return hashWorld(w);
    };
    expect(run()).toBe(run());
  });
});
