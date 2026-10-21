import { SQUAD } from '@avi/data';
import { describe, expect, it } from 'vitest';
import {
  applyCommand, applyTactical, createWorld, daysToHeal, deserialize, PERSONAL_ID, PRICES, readySoldiers, serialize,
  shoot, soldierHp, step, TICKS_PER_DAY, tileAt, woundHeal, type GameEvent, type World,
} from '../src';

function smallTown(seed: number) {
  const w = createWorld(seed);
  for (let x = 0; x < 12; x++) {
    for (let y = 0; y <= 6; y++) Object.assign(tileAt(w, x, y)!, { terrain: 'soil', object: 'none', zone: null, level: 0, root: -1, def: null });
  }
  for (let x = 0; x < 12; x++) {
    applyCommand(w, { type: 'buildRoad', x, y: 2 });
    applyCommand(w, { type: 'buildRoad', x, y: 4 });
  }
  applyCommand(w, { type: 'buildRoad', x: 0, y: 3 });
  applyCommand(w, { type: 'placeBuilding', def: 'plant', x: 0, y: 0 });
  applyCommand(w, { type: 'placeBuilding', def: 'pump', x: 2, y: 1 });
  return w;
}

function withCrash(w: World) {
  w.crash = { x: 8, y: 3, ufo: 'scout', expiresDay: w.day + 10 };
  Object.assign(tileAt(w, 8, 3)!, { object: 'crash', def: 'scout', zone: null, level: 0 });
  w.money = 100000;
  return w;
}

const days = (w: World, n: number) => step(w, TICKS_PER_DAY * n);

describe('ранения', () => {
  it('потерянное здоровье - дни лечения, тяжёлое ранение - сверху', () => {
    const max = SQUAD.soldier.hp;
    expect(woundHeal(max)).toBe(0);
    expect(woundHeal(max - 2)).toBe(2 * SQUAD.heal.daysPerHp);
    expect(woundHeal(0)).toBe(max * SQUAD.heal.daysPerHp + SQUAD.heal.downDays);
    expect(woundHeal(-3)).toBe(woundHeal(0));
  });

  it('здоровье восстанавливается по мере лечения', () => {
    const s = { id: 2, name: 'x', heal: woundHeal(0) };
    expect(soldierHp(s)).toBe(0);
    s.heal = woundHeal(2);
    expect(soldierHp(s)).toBe(2);
    s.heal = 1;
    expect(soldierHp(s)).toBe(SQUAD.soldier.hp - 1);
    s.heal = 0;
    expect(soldierHp(s)).toBe(SQUAD.soldier.hp);
  });

  it('после боя раненые лечатся, никто не гибнет и замену не оплачивают', () => {
    const w = withCrash(smallTown(3));
    expect(applyCommand(w, { type: 'assaultCrash' }).ok).toBe(true);
    const m = w.mission!;
    const team = m.units.filter((u) => u.side === 'xcom');
    expect(team.map((u) => u.soldier)).toEqual(w.soldiers.map((s) => s.id));
    team[0].hp = 0;
    team[1].hp = 2;
    applyTactical(w, { type: 'tacRetreat' });
    const money = w.money;
    applyTactical(w, { type: 'tacFinish' });
    expect(w.money).toBe(money);
    expect(w.soldiers).toHaveLength(SQUAD.size);
    expect(w.soldiers[0].heal).toBe(woundHeal(0));
    expect(w.soldiers[1].heal).toBe(woundHeal(2));
    expect(readySoldiers(w)).toHaveLength(SQUAD.size - 2);
    expect(w.events.at(-1)).toEqual({ type: 'missionFailed', ufo: 'scout', wounded: 1, down: 1, retreat: true });
    expect(w.crash).not.toBeNull(); // место крушения осталось - можно вернуться
  });

  it('в бою боец XCOM при нуле здоровья тяжело ранен, а не уничтожен', () => {
    const w = withCrash(smallTown(17));
    applyCommand(w, { type: 'assaultCrash' });
    const m = w.mission!;
    const alien = m.units.find((u) => u.side === 'alien')!;
    const soldier = m.units.find((u) => u.side === 'xcom')!;
    soldier.hp = 1;
    shoot(w, m, alien, soldier, false, 100);
    expect(soldier.hp).toBe(0);
    expect(m.log.at(-1)).toContain('Иван Петров: тяжёлое ранение, выбывает из боя');
    expect(m.log.at(-1)).not.toContain('уничтожена');
    soldier.hp = 3;
    alien.hp = 1;
    shoot(w, m, soldier, alien, false, 100);
    expect(m.log.at(-1)).toContain('цель уничтожена');
  });

  it('на миссию идут только здоровые', () => {
    const w = withCrash(smallTown(4));
    w.soldiers[0].heal = 5;
    w.soldiers[3].heal = 9;
    expect(applyCommand(w, { type: 'assaultCrash' }).ok).toBe(true);
    const ids = w.mission!.units.filter((u) => u.side === 'xcom').map((u) => u.soldier);
    expect(ids).toEqual([2, 3, 5, 6]);
    // Личный боец ранен - звёздочки на поле нет
    expect(w.mission!.units.some((u) => u.personal)).toBe(false);
  });

  it(`меньше ${SQUAD.minSquad} здоровых - отряд не вызвать, деньги не списываются`, () => {
    const w = withCrash(smallTown(5));
    for (const s of w.soldiers.slice(SQUAD.minSquad - 1)) s.heal = 10;
    const money = w.money;
    expect(applyCommand(w, { type: 'assaultCrash' })).toEqual({ ok: false, reason: 'no_squad' });
    expect(w.money).toBe(money);
    expect(w.mission).toBeNull();
    w.soldiers[SQUAD.minSquad].heal = 0;
    expect(applyCommand(w, { type: 'assaultCrash' })).toEqual({ ok: true, cost: PRICES.assault, count: 1 });
  });

  it('пока отряд лечится, место крушения можно упустить', () => {
    const w = withCrash(smallTown(6));
    for (const s of w.soldiers) s.heal = 30;
    w.speed = 1;
    const seen: GameEvent[] = [];
    for (let d = 0; d < 12; d++) {
      days(w, 1);
      seen.push(...w.events);
      w.events.length = 0;
    }
    expect(w.crash).toBeNull();
    expect(seen.some((e) => e.type === 'crashExpired')).toBe(true);
    expect(readySoldiers(w)).toHaveLength(0);
  });
});

describe('лечение', () => {
  it('без лазарета - очко в день, с лазаретом - втрое быстрее', () => {
    const w = smallTown(8);
    w.money = 100000;
    w.resources.metal = 500;
    w.soldiers[1].heal = 12;
    days(w, 3);
    expect(w.stats.healRate).toBe(1);
    expect(w.soldiers[1].heal).toBe(9);
    expect(daysToHeal(w, w.soldiers[1])).toBe(9);

    expect(applyCommand(w, { type: 'placeBuilding', def: 'clinic', x: 8, y: 5 }).ok).toBe(true);
    days(w, 6); // стройка 5 дней, потом работает с током
    expect(w.stats.healRate).toBe(3);
    w.soldiers[1].heal = 7;
    expect(daysToHeal(w, w.soldiers[1])).toBe(3);
    days(w, 2);
    expect(w.soldiers[1].heal).toBe(1);
    w.events.length = 0;
    days(w, 1);
    expect(w.soldiers[1].heal).toBe(0);
    expect(w.events).toContainEqual({ type: 'soldierRecovered', name: w.soldiers[1].name });
  });

  it('лазарет без тока не лечит быстрее', () => {
    const w = createWorld(9);
    w.money = 100000;
    w.resources.metal = 500;
    for (let x = 0; x < 4; x++) for (let y = 0; y < 3; y++) Object.assign(tileAt(w, x, y)!, { terrain: 'soil', object: 'none', zone: null, level: 0, root: -1, def: null });
    for (let x = 0; x < 4; x++) applyCommand(w, { type: 'buildRoad', x, y: 2 });
    expect(applyCommand(w, { type: 'placeBuilding', def: 'clinic', x: 0, y: 0 }).ok).toBe(true);
    days(w, 7);
    expect(w.stats.healRate).toBe(1);
  });
});

describe('состав отряда', () => {
  it('наём: разовая плата, зарплата запасным, предел состава', () => {
    const w = smallTown(10);
    w.money = 100000;
    days(w, 1);
    const upkeep = w.stats.upkeepDay;
    const money = w.money;
    expect(applyCommand(w, { type: 'hireSoldier' })).toEqual({ ok: true, cost: SQUAD.hireCost, count: 1 });
    expect(w.money).toBe(money - SQUAD.hireCost);
    expect(w.soldiers).toHaveLength(SQUAD.size + 1);
    const hired = w.soldiers.at(-1)!;
    expect(hired.heal).toBe(0);
    expect(new Set(w.soldiers.map((s) => s.name)).size).toBe(w.soldiers.length);
    days(w, 1);
    expect(w.stats.upkeepDay - upkeep).toBe(SQUAD.salary);
    while (w.soldiers.length < SQUAD.maxRoster) applyCommand(w, { type: 'hireSoldier' });
    expect(applyCommand(w, { type: 'hireSoldier' })).toEqual({ ok: false, reason: 'squad_full' });
  });

  it('наём без денег не проходит', () => {
    const w = smallTown(12);
    w.money = SQUAD.hireCost - 1;
    expect(applyCommand(w, { type: 'hireSoldier' })).toEqual({ ok: false, reason: 'no_money' });
    expect(w.soldiers).toHaveLength(SQUAD.size);
  });

  it('уволить можно любого, кроме личного бойца', () => {
    const w = smallTown(13);
    expect(applyCommand(w, { type: 'dismissSoldier', id: PERSONAL_ID })).toEqual({ ok: false, reason: 'nothing' });
    expect(applyCommand(w, { type: 'dismissSoldier', id: 4 }).ok).toBe(true);
    expect(w.soldiers.map((s) => s.id)).toEqual([1, 2, 3, 5, 6]);
    expect(applyCommand(w, { type: 'dismissSoldier', id: 4 })).toEqual({ ok: false, reason: 'nothing' });
  });

  it('состав и лечение переживают сохранение', () => {
    const w = smallTown(14);
    w.soldiers[2].heal = 7;
    const res = deserialize(serialize(w));
    expect(res.ok && res.world.soldiers).toEqual(w.soldiers);
  });
});

describe('миграция v7 -> v8', () => {
  const asV7 = (w: World) => {
    const file = JSON.parse(serialize(w));
    file.saveVersion = 7;
    delete file.world.soldiers;
    if (file.world.mission) for (const u of file.world.mission.units) delete u.soldier;
    return JSON.stringify(file);
  };

  it('старый город получает здоровый отряд', () => {
    const res = deserialize(asV7(smallTown(15)));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.world.soldiers).toHaveLength(SQUAD.size);
    expect(res.world.soldiers.every((s) => s.heal === 0)).toBe(true);
    expect(res.world.soldiers[0].id).toBe(PERSONAL_ID);
  });

  it('бой, сохранённый посреди миссии, привязывается к составу', () => {
    const w = withCrash(smallTown(16));
    applyCommand(w, { type: 'assaultCrash' });
    const xcom = w.mission!.units.filter((u) => u.side === 'xcom');
    xcom[0].name = 'Старое Имя (вы)';
    const res = deserialize(asV7(w));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const units = res.world.mission!.units.filter((u) => u.side === 'xcom');
    expect(units.map((u) => u.soldier)).toEqual(res.world.soldiers.map((s) => s.id));
    expect(res.world.soldiers[0].name).toBe('Старое Имя');
    expect(new Set(res.world.soldiers.map((s) => s.name)).size).toBe(SQUAD.size);
    // После боя ранение записывается бойцу из состава
    units[1].hp = 1;
    applyTactical(res.world, { type: 'tacRetreat' });
    applyTactical(res.world, { type: 'tacFinish' });
    expect(res.world.soldiers[1].heal).toBe(woundHeal(1));
  });
});
