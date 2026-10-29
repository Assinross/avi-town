import { SQUAD, WASTELAND } from '@avi/data';
import { describe, expect, it } from 'vitest';
import { applyCommand, bandMood, createWorld, hashWorld, PRICES, readySoldiers, step, TICKS_PER_DAY, tileAt, type GameEvent, type World } from '../src';

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
function bandArrives(w: World): GameEvent[] {
  w.nextBandDay = w.day;
  const seen: GameEvent[] = [];
  for (let t = 0; t < TICKS_PER_DAY * 4 && !w.band?.arrived; t++) {
    step(w, 1);
    seen.push(...w.events);
    w.events.length = 0;
  }
  return seen;
}

describe('кочующие банды', () => {
  it('первая банда - примерно с третьего месяца', () => {
    const w = createWorld(1);
    expect(w.nextBandDay).toBeGreaterThanOrEqual(B.firstDay);
    expect(w.nextBandDay).toBeLessThan(B.firstDay + B.firstSpread);
  });

  it('выходит из пустоши, доходит до города, ставит игру на паузу и громит дома', () => {
    const w = town(3);
    expect(w.stats.population).toBeGreaterThan(0);
    w.speed = 1;
    const seen = bandArrives(w);
    expect(seen.some((e) => e.type === 'bandSpotted')).toBe(true);
    expect(seen.some((e) => e.type === 'bandArrived')).toBe(true);
    expect(w.band!.members.length).toBeGreaterThanOrEqual(B.size[0]);
    expect(w.speed).toBe(0);
    const levels = () => w.tiles.reduce((n, t) => n + (t.object === 'zone' ? t.level : 0), 0);
    const before = levels();
    step(w, B.hitTicks * 3);
    expect(levels()).toBeLessThan(before);
  });

  it('пока банда в городе, горожане недовольны', () => {
    const w = town(4);
    bandArrives(w);
    expect(bandMood(w)).toBe(B.mood);
    w.band!.terror = true;
    expect(bandMood(w)).toBe(B.terrorMood);
  });

  it('отряд разгоняет банду: трофеи за каждого, опыт, следующая банда не скоро', () => {
    const w = town(5);
    bandArrives(w);
    const n = w.band!.members.length;
    const money = w.money;
    expect(applyCommand(w, { type: 'assaultBand' }).ok).toBe(true);
    expect(w.fight?.target).toBe('band');
    const seen: GameEvent[] = [];
    for (let t = 0; t < 4000 && w.fight; t++) {
      step(w, 1);
      seen.push(...w.events);
      w.events.length = 0;
    }
    const won = seen.find((e) => e.type === 'bandCleared');
    expect(won).toBeTruthy();
    expect(w.band).toBeNull();
    expect(w.money).toBe(money - PRICES.assault + (B.mutants.trophy.money ?? 0) * n);
    expect(w.soldiers.every((s) => s.xp === SQUAD.fight.xpWin)).toBe(true);
    expect(w.nextBandDay).toBeGreaterThan(w.day + B.minGap - 1);
  });

  it('проигрыш: отряд эвакуирован, банда остаётся, но дома больше не ломает и уходит в срок', () => {
    const w = town(6);
    bandArrives(w);
    applyCommand(w, { type: 'assaultBand' });
    for (const x of w.fight!.squad) x.hp = 0;
    step(w, 1);
    expect(w.fight).toBeNull();
    expect(readySoldiers(w)).toHaveLength(0);
    expect(w.band!.terror).toBe(true);
    const snapshot = w.tiles.map((t) => `${t.object}${t.level}`).join();
    step(w, B.hitTicks * 3);
    expect(w.tiles.map((t) => `${t.object}${t.level}`).join()).toBe(snapshot);
    const seen: GameEvent[] = [];
    for (let d = 0; d <= B.days && w.band; d++) {
      step(w, TICKS_PER_DAY);
      seen.push(...w.events);
      w.events.length = 0;
    }
    expect(w.band).toBeNull();
    expect(seen.some((e) => e.type === 'bandLeft')).toBe(true);
  });

  it('без здоровых бойцов отряд на банду не выслать', () => {
    const w = town(7);
    bandArrives(w);
    for (const s of w.soldiers) s.heal = 20;
    expect(applyCommand(w, { type: 'assaultBand' })).toEqual({ ok: false, reason: 'no_squad' });
  });

  it('банда и автобой детерминированы', () => {
    const run = () => {
      const w = town(8);
      bandArrives(w);
      applyCommand(w, { type: 'assaultBand' });
      step(w, 2000);
      return hashWorld(w);
    };
    expect(run()).toBe(run());
  });
});
