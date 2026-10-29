import { WASTELAND } from '@avi/data';
import { describe, expect, it } from 'vitest';
import { applyCommand, bandMood, createWorld, PRICES, step, TICKS_PER_DAY, tileAt, type World } from '../src';

const B = WASTELAND.bands;

/** Городок в центре карты: дороги, ток, вода и подросшие дома. */
function town(seed: number): World {
  const w = createWorld(seed);
  for (let x = 24; x < 40; x++) {
    for (let y = 26; y <= 34; y++) Object.assign(tileAt(w, x, y)!, { terrain: 'soil', object: 'none', zone: null, level: 0, root: -1, def: null });
  }
  for (let x = 24; x < 40; x++) {
    applyCommand(w, { type: 'buildRoad', x, y: 30 });
    applyCommand(w, { type: 'buildRoad', x, y: 32 });
  }
  applyCommand(w, { type: 'buildRoad', x: 24, y: 31 });
  applyCommand(w, { type: 'placeBuilding', def: 'plant', x: 24, y: 28 });
  applyCommand(w, { type: 'placeBuilding', def: 'pump', x: 26, y: 29 });
  applyCommand(w, { type: 'zone', rect: { x0: 28, y0: 31, x1: 39, y1: 31 }, zone: 'R' });
  w.money = 100000;
  step(w, TICKS_PER_DAY * 20);
  w.events.length = 0;
  return w;
}

/** Вызвать банду сейчас и дождаться, пока она дойдёт до города. */
function bandArrives(w: World) {
  w.nextBandDay = w.day;
  for (let t = 0; t < TICKS_PER_DAY * 4 && !w.band?.arrived; t++) step(w, 1);
}

describe('кочующие банды', () => {
  it('приходит, громит дома, отряд разгоняет её и привозит трофеи', () => {
    const w = town(3);
    w.speed = 1;
    bandArrives(w);
    expect(w.speed).toBe(0);
    const levels = () => w.tiles.reduce((n, t) => n + (t.object === 'zone' ? t.level : 0), 0);
    const before = levels();
    step(w, B.hitTicks * 3);
    expect(levels()).toBeLessThan(before);
    const n = w.band!.members.length;
    const money = w.money;
    expect(applyCommand(w, { type: 'assaultBand' }).ok).toBe(true);
    for (let t = 0; t < 8000 && w.fight; t++) step(w, 1);
    expect(w.band).toBeNull();
    expect(w.money).toBeGreaterThanOrEqual(money - PRICES.assault + (B.mutants.trophy.money ?? 0) * n);
  });

  it('проигрыш: банда остаётся, дома не ломает, горожане в страхе, уходит в срок', () => {
    const w = town(6);
    bandArrives(w);
    applyCommand(w, { type: 'assaultBand' });
    for (const x of w.fight!.squad) x.hp = 0;
    step(w, 1);
    expect(w.band!.terror).toBe(true);
    expect(bandMood(w)).toBe(B.terrorMood);
    const snapshot = w.tiles.map((t) => `${t.object}${t.level}`).join();
    step(w, B.hitTicks * 3);
    expect(w.tiles.map((t) => `${t.object}${t.level}`).join()).toBe(snapshot);
    for (let d = 0; d <= B.days && w.band; d++) step(w, TICKS_PER_DAY);
    expect(w.band).toBeNull();
  });
});
