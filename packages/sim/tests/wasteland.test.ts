import { SQUAD, WASTELAND } from '@avi/data';
import { describe, expect, it } from 'vitest';
import {
  applyCommand, applyTactical, awaySoldiers, bunkerCenter, createWorld, deserialize, hashWorld, landingTick, newWasteland,
  readySoldiers, reveal, rosterCap, serialize, step, TICKS_PER_DAY, tileAt, type World,
} from '../src';

/** Пустошь с ровной разведанной землёй вокруг бункера: ряд дорог к востоку от него. */
function camp(seed = 5) {
  const w = newWasteland(seed);
  const c = bunkerCenter(w)!;
  for (let y = c.y - 6; y <= c.y + 6; y++) {
    for (let x = c.x - 6; x <= c.x + 8; x++) {
      const t = tileAt(w, x, y);
      if (!t || t.object === 'building') continue;
      Object.assign(t, { terrain: 'soil', object: 'none', zone: null, level: 0, root: -1, def: null });
    }
  }
  w.money = 100000;
  return { w, c };
}

const explored = (w: World) => w.explored.reduce((a, v) => a + v, 0);

describe('выход из бункера', () => {
  it('новая карта: бункер, открытый круг вокруг него, туман дальше, находки под туманом', () => {
    const w = newWasteland(3);
    const c = bunkerCenter(w)!;
    expect(tileAt(w, c.x, c.y)!.def).toBe('bunker');
    expect(w.explored[c.y * w.size + c.x]).toBe(1);
    expect(explored(w)).toBeLessThan(w.size * w.size / 4);
    expect(w.sites.length).toBeGreaterThan(5);
    expect(w.sites.some((s) => s.kind === 'nest')).toBe(true);
    expect(hashWorld(newWasteland(3))).toBe(hashWorld(newWasteland(3)));
    expect(hashWorld(newWasteland(3))).not.toBe(hashWorld(newWasteland(4)));
  });

  it('у старта есть вода или источник и плодородная земля', () => {
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const w = newWasteland(seed);
      const c = bunkerCenter(w)!;
      let soil = 0, water = false;
      for (let dy = -10; dy <= 10; dy++) {
        for (let dx = -10; dx <= 10; dx++) {
          const t = tileAt(w, c.x + dx, c.y + dy);
          if (t?.terrain === 'soil') soil++;
          if (t?.terrain === 'water') water = true;
        }
      }
      const spring = w.sites.some((s) => s.kind === 'spring' && Math.hypot(s.x - c.x, s.y - c.y) < 10);
      expect(soil).toBeGreaterThan(10);
      expect(water || spring).toBe(true);
    }
  });

  it('в тумане строить нельзя, дорога открывает туман вокруг себя', () => {
    const { w, c } = camp();
    const far = w.sites.find((s) => !s.found)!;
    expect(applyCommand(w, { type: 'buildRoad', x: far.x, y: far.y })).toEqual({ ok: false, reason: 'fog' });
    // Дорога вдоль края разведанного круга открывает клетки дальше
    const before = explored(w);
    for (let x = c.x + 2; x <= c.x + WASTELAND.reveal.bunker; x++) {
      Object.assign(tileAt(w, x, c.y)!, { terrain: 'soil', object: 'none' });
      applyCommand(w, { type: 'buildRoad', x, y: c.y });
    }
    expect(explored(w)).toBeGreaterThan(before);
    expect(w.explored[c.y * w.size + c.x + WASTELAND.reveal.bunker + WASTELAND.reveal.road]).toBe(1);
  });

  it('бункер не сносится и не строится игроком', () => {
    const { w, c } = camp();
    applyCommand(w, { type: 'bulldoze', rect: { x0: c.x - 1, y0: c.y - 1, x1: c.x + 1, y1: c.y + 1 } });
    expect(tileAt(w, c.x, c.y)!.def).toBe('bunker');
    expect(applyCommand(w, { type: 'placeBuilding', def: 'bunker', x: c.x + 3, y: c.y + 3 }).ok).toBe(false);
  });
});

describe('броневик', () => {
  function crashNear(w: World, x: number, y: number) {
    Object.assign(tileAt(w, x, y)!, { object: 'crash', def: 'smallScout' });
    w.crash = { x, y, ufo: 'smallScout', expiresDay: w.day + 10 };
  }

  it('выезжает из бункера, едет по времени, бой начинается на месте, после боя возвращается', () => {
    const { w, c } = camp();
    for (let x = c.x + 2; x <= c.x + 7; x++) applyCommand(w, { type: 'buildRoad', x, y: c.y });
    crashNear(w, c.x + 8, c.y);
    expect(applyCommand(w, { type: 'assaultCrash' }).ok).toBe(true);
    expect(w.mission).toBeNull();
    expect(w.convoy).not.toBeNull();
    expect(readySoldiers(w)).toHaveLength(0);
    let ticks = 0;
    while (!w.mission && ticks < 4000) { step(w, 1); ticks++; }
    expect(w.mission).not.toBeNull();
    expect(ticks).toBeGreaterThan(30);
    expect(w.mission!.units.filter((u) => u.side === 'xcom')).toHaveLength(SQUAD.size);
    applyTactical(w, { type: 'tacRetreat' });
    applyTactical(w, { type: 'tacFinish' });
    expect(w.convoy?.phase).toBe('back');
    step(w, 4000);
    expect(w.convoy).toBeNull();
    expect(awaySoldiers(w).size).toBe(0);
  });

  it('по бездорожью дольше, чем по дороге', () => {
    const run = (road: boolean) => {
      const { w, c } = camp();
      if (road) for (let x = c.x + 2; x <= c.x + 7; x++) applyCommand(w, { type: 'buildRoad', x, y: c.y });
      crashNear(w, c.x + 8, c.y);
      applyCommand(w, { type: 'assaultCrash' });
      let ticks = 0;
      while (!w.mission && ticks < 8000) { step(w, 1); ticks++; }
      return ticks;
    };
    expect(run(false)).toBeGreaterThan(run(true) * 2);
  });
});

describe('экспедиции и находки', () => {
  it('экспедиция требует исследования, уходит, открывает туман и возвращается', () => {
    const { w, c } = camp();
    const tx = Math.min(w.size - 2, c.x + 25), ty = c.y;
    expect(applyCommand(w, { type: 'sendExpedition', x: tx, y: ty, soldiers: 2 })).toEqual({ ok: false, reason: 'not_researched' });
    w.research.done.push(WASTELAND.expedition.tech);
    const money = w.money, food = w.food;
    expect(applyCommand(w, { type: 'sendExpedition', x: tx, y: ty, soldiers: 2 }).ok).toBe(true);
    expect(w.money).toBeLessThan(money);
    expect(w.food).toBeLessThan(food);
    expect(awaySoldiers(w).size).toBe(2);
    const before = explored(w);
    step(w, TICKS_PER_DAY * 10);
    expect(w.expeditions).toHaveLength(0);
    expect(awaySoldiers(w).size).toBe(0);
    expect(explored(w)).toBeGreaterThan(before);
    expect(w.explored[ty * w.size + tx]).toBe(1);
  });

  it('тайник забирается, как только клетку разведали', () => {
    const { w } = camp();
    const cache = w.sites.find((s) => s.kind === 'cache' && !s.found)!;
    const money = w.money, metal = w.resources.metal;
    reveal(w, cache.x, cache.y, 1);
    expect(cache.found && cache.done).toBe(true);
    expect(w.money + w.resources.metal).toBeGreaterThan(money + metal);
    expect(w.events.some((e) => e.type === 'siteFound' && e.kind === 'cache')).toBe(true);
  });
});

describe('улучшения бункера и десант', () => {
  it('казарма II за несколько дней добавляет мест в отряде', () => {
    const { w } = camp();
    w.resources.metal = 500;
    const cap = rosterCap(w);
    expect(applyCommand(w, { type: 'upgradeBunker', id: 'barracks3' }).ok).toBe(false);
    expect(applyCommand(w, { type: 'upgradeBunker', id: 'barracks2' }).ok).toBe(true);
    expect(applyCommand(w, { type: 'upgradeBunker', id: 'medbay' })).toEqual({ ok: false, reason: 'busy' });
    step(w, TICKS_PER_DAY * 6);
    expect(rosterCap(w)).toBe(cap + 3);
  });

  it('десант бьёт дома рядом, пока не приехал отряд', () => {
    const { w, c } = camp();
    const x = c.x + 5, y = c.y + 3;
    Object.assign(tileAt(w, x + 1, y)!, { object: 'zone', zone: 'I', level: 2, root: -1 });
    Object.assign(tileAt(w, x, y)!, { object: 'crash', def: 'scout' });
    w.crash = { x, y, ufo: 'scout', expiresDay: w.day + 4, landed: true, timer: 1 };
    landingTick(w);
    expect(tileAt(w, x + 1, y)!.level).toBe(1);
  });
});

describe('сохранение пустоши', () => {
  it('сохранение и загрузка дают тот же мир', () => {
    const { w, c } = camp();
    w.research.done.push(WASTELAND.expedition.tech);
    applyCommand(w, { type: 'sendExpedition', x: Math.min(w.size - 2, c.x + 20), y: c.y, soldiers: 1 });
    step(w, TICKS_PER_DAY * 2);
    const res = deserialize(serialize(w));
    expect(res.ok).toBe(true);
    if (res.ok) expect(hashWorld(res.world)).toBe(hashWorld(w));
  });

  it('старое сохранение: туман открыт, находок нет, бункер у города, если есть место', () => {
    const w = createWorld(9);
    for (let x = 10; x < 30; x++) for (let y = 18; y < 26; y++) Object.assign(tileAt(w, x, y)!, { terrain: 'soil', object: 'none', zone: null, level: 0, root: -1, def: null });
    for (let x = 10; x < 30; x++) applyCommand(w, { type: 'buildRoad', x, y: 20 });
    const file = JSON.parse(serialize(w));
    file.saveVersion = 10;
    for (const k of ['explored', 'sites', 'bunker', 'convoy', 'expeditions']) delete file.world[k];
    delete file.world.research.archives;
    const res = deserialize(JSON.stringify(file));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.world.explored.every((v) => v === 1)).toBe(true);
    expect(res.world.sites).toEqual([]);
    expect(res.world.bunker).not.toBeNull();
    expect(res.world.research.archives).toBe(0);
  });
});
