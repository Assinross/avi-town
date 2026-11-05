import { describe, expect, it } from 'vitest';
import { TRANSIT } from '@avi/data';
import { applyCommand, createWorld, deserialize, History, newTransit, serialize, syncTransit } from '../src';

function town() {
  const w = createWorld(1, 24);
  w.money = 50000;
  for (const t of w.tiles) Object.assign(t, { terrain: 'soil', object: 'none', root: -1, def: null, zone: null });
  for (let x = 1; x < 22; x++) applyCommand(w, { type: 'buildRoad', x, y: 5 });
  applyCommand(w, { type: 'placeBuilding', def: 'bus_depot', x: 1, y: 3 });
  for (const t of w.tiles) if (t.def === 'bus_depot') t.build = 0;
  syncTransit(w);
  return w;
}

describe('управляемый общественный транспорт', () => {
  it('депо выдаёт один автобус и три остановки один раз', () => {
    const w = town();
    syncTransit(w); syncTransit(w);
    expect(w.transit.tokens).toBe(3);
    expect(w.transit.buses).toHaveLength(1);
    expect(TRANSIT.capacity[w.transit.buses[0].level - 1]).toBe(4);
  });

  it('покупки ограничены деньгами и общим пределом четырёх остановок', () => {
    const w = town(), before = w.money;
    expect(applyCommand(w, { type: 'buyBusStop' }).ok).toBe(true);
    expect(w.money).toBe(before - TRANSIT.stopPrice);
    expect(applyCommand(w, { type: 'buyBusStop' }).ok).toBe(false);
    w.money = 0;
    expect(applyCommand(w, { type: 'buyBus' })).toEqual({ ok: false, reason: 'no_money' });
    expect(w.transit.buses).toHaveLength(1);
  });

  it('сохраняет ручной порядок, отклоняет разрыв дороги и возвращает снятую остановку в запас', () => {
    const w = town();
    for (const x of [4, 10, 16]) expect(applyCommand(w, { type: 'placeBusStop', x, y: 5 }).ok).toBe(true);
    const ids = w.transit.stops.map((s) => s.id), bus = w.transit.buses[0];
    const order = [ids[2], ids[0], ids[1]];
    expect(applyCommand(w, { type: 'setBusRoute', id: bus.id, stops: order }).ok).toBe(true);
    expect(bus.route).toEqual(order);
    w.tiles[5 * w.size + 7].object = 'none';
    expect(applyCommand(w, { type: 'setBusRoute', id: bus.id, stops: ids })).toEqual({ ok: false, reason: 'no_path' });
    expect(bus.route).toEqual(order);
    applyCommand(w, { type: 'removeBusStop', id: ids[1] });
    expect(w.transit.tokens).toBe(1);
    expect(bus.route).not.toContain(ids[1]);
  });

  it('расширение требует развития города, а остановки на перекрёстке запрещены', () => {
    const w = town();
    expect(applyCommand(w, { type: 'expandBusStops' })).toEqual({ ok: false, reason: 'transit_growth' });
    w.stats.population = TRANSIT.expansionPopulation[1];
    expect(applyCommand(w, { type: 'expandBusStops' }).ok).toBe(true);
    expect(TRANSIT.stopLimits[w.transit.expansion]).toBe(6);
    applyCommand(w, { type: 'buildRoad', x: 8, y: 4 });
    expect(applyCommand(w, { type: 'placeBusStop', x: 8, y: 5 }).ok).toBe(false);
  });

  it('сохраняет покупки и мигрирует старый город без бесплатных автобусов', () => {
    const w = town();
    applyCommand(w, { type: 'upgradeBus', id: w.transit.buses[0].id });
    const loaded = deserialize(serialize(w));
    expect(loaded.ok && loaded.world.transit).toEqual(w.transit);
    const old = JSON.parse(serialize(createWorld(2, 16)));
    old.saveVersion = 12; delete old.world.transit;
    const migrated = deserialize(JSON.stringify(old));
    expect(migrated.ok && migrated.world.transit).toEqual(newTransit());
  });

  it('отмена сноса дороги восстанавливает остановку и маршрут', () => {
    const w = town(), h = new History();
    applyCommand(w, { type: 'placeBusStop', x: 10, y: 5 });
    const id = w.transit.stops[0].id;
    applyCommand(w, { type: 'setBusRoute', id: w.transit.buses[0].id, stops: [id] });
    applyCommand(w, { type: 'bulldoze', rect: { x0: 10, y0: 5, x1: 10, y1: 5 } }, h);
    expect(w.transit.stops).toHaveLength(0);
    expect(h.undo(w)).toBe(true);
    expect(w.transit.stops[0].id).toBe(id);
    expect(w.transit.buses[0].route).toEqual([id]);
  });
});
