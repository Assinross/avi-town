import { describe, expect, it } from 'vitest';
import { ALIEN_BY_ID, ALIENS, BATTLE, COVERS, COVER_BY_ID, SQUAD, t } from '@avi/data';
import {
  alienTurn, applyTactical, canSee, coverOf, createWorld, damageProp, deserialize, distances, envDamageOf, fxPos,
  hasAdjacentCover, hashWorld, hitChance, magOf, moveCost, nextInt, reactionChance, SAVE_VERSION, seedRng, serialize, shoot, sightOf,
  solidPropAt, startAlienTurn, startXcomTurn, triggerOverwatch, visibleCells,
  type CellKind, type Mission, type PropState, type TacUnit, type World,
} from '../src';

// --- Хелперы боя -----------------------------------------------------------------------------

const W = 12, H = 12;

function makeMission(over: Partial<Mission> = {}): Mission {
  const w = over.w ?? W, h = over.h ?? H;
  return {
    ufo: 'scout', ox: 0, oy: 0, w, h,
    cells: new Array(w * h).fill(0) as CellKind[],
    units: [], props: [], phase: 'turn', turn: 1, result: null, log: [],
    ...over,
  };
}

function makeUnit(id: number, side: 'xcom' | 'alien', x: number, y: number, over: Partial<TacUnit> = {}): TacUnit {
  return {
    id, side, kind: side === 'xcom' ? 'soldier' : 'Sectoid', name: `${side}${id}`,
    x, y, hp: 10, maxHp: 10, aim: 70, mobility: 10, damage: [1, 2], ap: 2,
    path: [], moveAcc: 0, ammo: 4, overwatch: false, hunkered: false,
    ...over,
  };
}

function putProp(m: Mission, x: number, y: number, kind = 'brick_wall', state: PropState = 'whole'): void {
  const def = COVER_BY_ID[kind];
  m.props.push({ id: m.props.length + 1, cell: y * m.w + x, kind, hp: def.hp, maxHp: def.hp, state });
}

/** Мир с готовой миссией - для детерминированных выстрелов в тестах разрушения. */
function makeWorld(m: Mission, seed = 1) {
  const w = createWorld(seed);
  w.mission = m;
  return w;
}

/** Сид, при котором первый бросок nextInt(rng, 100) (проверка попадания в shoot) удовлетворяет условию. */
function seedWithRoll(pred: (roll: number) => boolean): number {
  for (let s = 1; s < 5000; s++) if (pred(nextInt(seedRng(s), 100))) return s;
  throw new Error('подходящий сид не найден');
}

describe('данные боя', () => {
  it('у укрытий уникальные id', () => {
    expect(COVERS).toHaveLength(13);
    const ids = COVERS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('укрытие даёт 20 или 40 защиты и имеет запас прочности', () => {
    for (const c of COVERS) {
      expect(c.cover === 20 || c.cover === 40).toBe(true);
      expect(c.hp).toBeGreaterThan(0);
    }
  });

  it('у укрытий заданы модель, обломки и название в локали', () => {
    for (const c of COVERS) {
      expect(c.model.length).toBeGreaterThan(0);
      expect(c.debris.length).toBeGreaterThan(0);
      expect(t(c.nameKey)).not.toBe(c.nameKey);
    }
  });

  it('у бойцов и пришельцев заданы боезапас и урон от окружения', () => {
    expect(Number.isFinite(SQUAD.soldier.mag)).toBe(true);
    expect(SQUAD.soldier.mag).toBeGreaterThanOrEqual(0);
    expect(Number.isFinite(SQUAD.soldier.envDamage)).toBe(true);
    expect(SQUAD.soldier.envDamage).toBeGreaterThanOrEqual(0);
    expect(SQUAD.soldier.mag).toBe(4);
    expect(SQUAD.soldier.envDamage).toBe(20);
    for (const a of ALIENS) {
      expect(Number.isFinite(a.mag)).toBe(true);
      expect(a.mag).toBeGreaterThanOrEqual(0);
      expect(Number.isFinite(a.envDamage)).toBe(true);
      expect(a.envDamage).toBeGreaterThanOrEqual(0);
    }
    // Пистолет Sectoid - бесконечный боезапас, у Мутона тяжёлое оружие.
    expect(ALIEN_BY_ID.Sectoid.mag).toBe(0);
    expect(ALIEN_BY_ID.Sectoid.envDamage).toBe(10);
    expect(ALIEN_BY_ID.Muton.mag).toBe(3);
    expect(ALIEN_BY_ID.Muton.envDamage).toBe(40);
  });

  it('правила боя содержат очки действий для всех действий', () => {
    expect(BATTLE.coverLow).toBe(20);
    expect(BATTLE.coverHigh).toBe(40);
    for (const cost of Object.values(BATTLE.ap)) expect(cost).toBeGreaterThan(0);
  });
});

describe('укрытия, фланг и хункер', () => {
  it('высокое укрытие со стороны стрелка даёт 40', () => {
    const m = makeMission();
    const target = makeUnit(1, 'alien', 5, 5);
    putProp(m, 5, 4); // brick_wall - полное укрытие, к северу от цели
    const from = makeUnit(2, 'xcom', 5, 2); // стрелок севернее
    expect(coverOf(m, target, from)).toBe(40);
  });

  it('пропс с другой стороны бонуса не даёт - это фланг', () => {
    const m = makeMission();
    const target = makeUnit(1, 'alien', 5, 5);
    putProp(m, 5, 4);
    const from = makeUnit(2, 'xcom', 5, 8); // стрелок южнее
    expect(coverOf(m, target, from)).toBe(0);
  });

  it('диагональному стрелку подходит укрытие по любой из осей', () => {
    const m = makeMission();
    const target = makeUnit(1, 'alien', 5, 5);
    putProp(m, 5, 4);
    const from = makeUnit(2, 'xcom', 8, 2); // северо-восток
    expect(coverOf(m, target, from)).toBe(40);
  });

  it('broken понижает укрытие на 20, collapsed не укрывает', () => {
    const m = makeMission();
    const target = makeUnit(1, 'alien', 5, 5);
    const from = makeUnit(2, 'xcom', 5, 2);
    putProp(m, 5, 4, 'brick_wall', 'broken');
    expect(coverOf(m, target, from)).toBe(20);
    m.props = [];
    putProp(m, 5, 4, 'brick_wall', 'collapsed');
    expect(coverOf(m, target, from)).toBe(0);
  });

  it('терраин укрывает: низкое 20, стена 40', () => {
    const m = makeMission();
    const target = makeUnit(1, 'alien', 5, 5);
    const from = makeUnit(2, 'xcom', 5, 2);
    m.cells[4 * m.w + 5] = 1;
    expect(coverOf(m, target, from)).toBe(20);
    m.cells[4 * m.w + 5] = 2;
    expect(coverOf(m, target, from)).toBe(40);
  });

  it('хункер удваивает укрытие: 40 -> 80, 20 -> 40, 0 -> 0', () => {
    const m = makeMission();
    const target = makeUnit(1, 'alien', 5, 5, { hunkered: true });
    const from = makeUnit(2, 'xcom', 5, 2);
    expect(coverOf(m, target, from)).toBe(0); // без укрытия хункер не даёт ничего
    putProp(m, 5, 4, 'brick_wall');
    expect(coverOf(m, target, from)).toBe(80);
    m.props = [];
    putProp(m, 5, 4, 'barrier'); // barrier - половинное укрытие 20
    expect(coverOf(m, target, from)).toBe(40);
  });

  it('hitChance снижается ровно на укрытие и зажат в 5..95', () => {
    const m = makeMission();
    const target = makeUnit(1, 'alien', 5, 5);
    const near = makeUnit(2, 'xcom', 5, 3, { aim: 70 }); // дистанция 2: бонус +15
    const open = hitChance(m, near, target);
    expect(open).toBe(85);
    putProp(m, 5, 4);
    expect(hitChance(m, near, target)).toBe(open - 40);
    expect(hitChance(m, makeUnit(3, 'xcom', 5, 3, { aim: 10 }), target)).toBe(5);
    m.props = [];
    expect(hitChance(m, makeUnit(4, 'xcom', 5, 3, { aim: 95 }), target)).toBe(95);
  });

  it('hasAdjacentCover видит только ортогональные соседние клетки', () => {
    const m = makeMission();
    const u = makeUnit(1, 'xcom', 5, 5);
    expect(hasAdjacentCover(m, u)).toBe(false);
    putProp(m, 6, 6); // по диагонали - не считается
    expect(hasAdjacentCover(m, u)).toBe(false);
    m.props = [];
    putProp(m, 6, 5); // справа
    expect(hasAdjacentCover(m, u)).toBe(true);
    m.props = [];
    putProp(m, 5, 4, 'crate', 'collapsed'); // разрушенный пропс не считается
    expect(hasAdjacentCover(m, u)).toBe(false);
    m.cells[4 * m.w + 5] = 1; // укрытие террейна считается
    expect(hasAdjacentCover(m, u)).toBe(true);
  });

  it('присевший видит вдвое меньше', () => {
    const m = makeMission();
    const eye = makeUnit(1, 'xcom', 1, 1);
    const target = makeUnit(2, 'alien', 1, 8); // дистанция 7
    expect(sightOf(eye)).toBe(BATTLE.sightCells);
    expect(sightOf({ ...eye, hunkered: true })).toBe(BATTLE.hunkerSightCells);
    expect(canSee(m, eye, target)).toBe(true);
    expect(canSee(m, { ...eye, hunkered: true }, target)).toBe(false);
    m.units = [{ ...eye, hunkered: true }];
    expect(visibleCells(m)[8 * m.w + 1]).toBe(0);
    m.units = [eye];
    expect(visibleCells(m)[8 * m.w + 1]).toBe(1);
  });
});

describe('перемещение сквозь укрытия', () => {
  it('целый и повреждённый твёрдый пропс блокируют клетку: distance -1, moveCost -1', () => {
    const m = makeMission();
    const u = makeUnit(1, 'xcom', 5, 5);
    putProp(m, 6, 5, 'brick_wall');
    let d = distances(m, u);
    expect(d[5 * m.w + 6]).toBe(-1);
    expect(moveCost(m, u, 6, 5, d)).toBe(-1);
    m.props[0].state = 'broken'; // обломки всё ещё перекрывают клетку
    d = distances(m, u);
    expect(d[5 * m.w + 6]).toBe(-1);
    expect(moveCost(m, u, 6, 5, d)).toBe(-1);
  });

  it('разрушенный пропс проходим и не укрывает', () => {
    const m = makeMission();
    const u = makeUnit(1, 'xcom', 5, 5);
    const from = makeUnit(2, 'alien', 5, 2); // стрелок севернее
    putProp(m, 5, 4, 'brick_wall', 'collapsed');
    expect(solidPropAt(m, 5, 4)).toBe(false);
    const d = distances(m, u);
    expect(d[4 * m.w + 5]).toBe(1);
    expect(moveCost(m, u, 5, 4, d)).toBeGreaterThan(0);
    expect(coverOf(m, u, from)).toBe(0);
  });
});

describe('разрушение укрытий', () => {
  it('состояние меняется по порогам данных: целое -> обломки -> разрушено', () => {
    const m = makeMission();
    const w = makeWorld(m);
    putProp(m, 5, 4, 'brick_wall'); // 30 hp из данных, твёрдое укрытие
    const p = m.props[0];
    const maxHp = COVER_BY_ID.brick_wall.hp;
    const brokenAt = maxHp * BATTLE.breakRatio; // остаток запаса, на котором укрытие пробито
    const collapsedAt = maxHp * BATTLE.collapseRatio; // остаток, на котором оно рухнуло
    expect(p.maxHp).toBe(maxHp);
    expect(p.state).toBe('whole');

    // 12 из 30 оставляют 0.6 запаса - выше порога обломков, состояние не меняется;
    // пробитие наступает на 15 (ровно BATTLE.breakRatio), разрушение - на 6
    damageProp(w, m, p, 12);
    expect(p.hp).toBe(maxHp - 12);
    expect(p.state).toBe('whole');

    damageProp(w, m, p, p.hp - brokenAt);
    expect(p.hp).toBe(brokenAt);
    expect(p.state).toBe('broken');

    damageProp(w, m, p, p.hp - collapsedAt);
    expect(p.hp).toBe(collapsedAt);
    expect(p.state).toBe('collapsed');
    expect(solidPropAt(m, 5, 4)).toBe(false); // путь свободен
    expect(coverOf(m, makeUnit(1, 'alien', 5, 5), makeUnit(2, 'xcom', 5, 2))).toBe(0); // и не укрывает
  });

  it('смена состояния даёт взрыв, запись в журнал и рост ревизии', () => {
    const m = makeMission();
    const w = makeWorld(m);
    putProp(m, 5, 4, 'brick_wall');
    const p = m.props[0];
    const rev = w.revision;

    damageProp(w, m, p, COVER_BY_ID.brick_wall.hp * (1 - BATTLE.breakRatio)); // ровно до обломков
    expect(p.state).toBe('broken');
    expect(w.fx).toEqual([{ type: 'explosion', ...fxPos(m, 5, 4), big: false }]);
    expect(w.revision).toBe(rev + 1);
    expect(m.log[m.log.length - 1]).toContain(t(COVER_BY_ID.brick_wall.nameKey));
    expect(m.log[m.log.length - 1]).toContain('пробито');

    damageProp(w, m, p, p.hp); // остаток в ноль - рухнуло
    expect(p.state).toBe('collapsed');
    expect(w.fx).toHaveLength(2);
    expect(w.fx[1]).toEqual({ type: 'explosion', ...fxPos(m, 5, 4), big: true });
    expect(m.log[m.log.length - 1]).toContain('рухнуло');
  });

  it('промах уходит в укрытие за целью, попадание укрытие не задевает', () => {
    const m = makeMission();
    const w = makeWorld(m);
    putProp(m, 5, 4, 'brick_wall');
    const shooter = makeUnit(1, 'xcom', 5, 2);
    const target = makeUnit(2, 'alien', 5, 5);
    m.units = [shooter, target];
    const chance = hitChance(m, shooter, target);
    const p = m.props[0];
    const hp = p.hp;

    w.rng = seedRng(seedWithRoll((r) => r < chance)); // попадание
    expect(shoot(w, m, shooter, target)).toBe(true);
    expect(target.hp).toBeLessThan(target.maxHp);
    expect(p.hp).toBe(hp);
    expect(p.state).toBe('whole');

    shooter.ap = 2;
    target.hp = target.maxHp;
    w.rng = seedRng(seedWithRoll((r) => r >= chance)); // промах
    expect(shoot(w, m, shooter, target)).toBe(false);
    expect(target.hp).toBe(target.maxHp);
    expect(p.hp).toBe(hp - envDamageOf(shooter)); // урон окружения бойца
    expect(p.state).toBe('broken'); // 20 урона пробивают стену 30 hp
    expect(m.log.some((l) => l.includes('укрытие'))).toBe(true);
  });
});

describe('боезапас, перезарядка и стоимость выстрела', () => {
  /** Сцена выстрела: боец в 3 клетках от пришельца, обзор чист (шанс 85%). */
  function shootScene(over: Partial<TacUnit> = {}) {
    const m = makeMission();
    const a = makeUnit(1, 'xcom', 5, 2, over);
    const b = makeUnit(2, 'alien', 5, 5);
    m.units = [a, b];
    return { m, a, b };
  }

  it('выстрел стоит ровно BATTLE.ap.shot и тратит один патрон', () => {
    const { m, a, b } = shootScene();
    const w = makeWorld(m);
    const mag = magOf(a);
    expect(mag).toBe(SQUAD.soldier.mag);
    expect(a.ammo).toBe(mag);
    expect(applyTactical(w, { type: 'tacShoot', unit: a.id, target: b.id })).toEqual({ ok: true });
    expect(a.ap).toBe(2 - BATTLE.ap.shot); // 2 ОД -> 1, а не в ноль
    expect(a.ammo).toBe(mag - 1);
  });

  it('второй выстрел в том же ходу: ОД в ноль, магазин минус два', () => {
    const { m, a, b } = shootScene();
    const w = makeWorld(m);
    const mag = magOf(a);
    applyTactical(w, { type: 'tacShoot', unit: a.id, target: b.id });
    expect(applyTactical(w, { type: 'tacShoot', unit: a.id, target: b.id })).toEqual({ ok: true });
    expect(a.ap).toBe(0);
    expect(a.ammo).toBe(mag - 2);
  });

  it('выстрел при пустом магазине - no_ammo: ОД и цель не тронуты', () => {
    const { m, a, b } = shootScene({ ammo: 0 });
    const w = makeWorld(m);
    expect(applyTactical(w, { type: 'tacShoot', unit: a.id, target: b.id })).toEqual({ ok: false, reason: 'no_ammo' });
    expect(a.ap).toBe(2);
    expect(a.ammo).toBe(0);
    expect(b.hp).toBe(b.maxHp);
  });

  it('выстрел без ОД - no_ap', () => {
    const { m, a, b } = shootScene({ ap: 0 });
    const w = makeWorld(m);
    expect(applyTactical(w, { type: 'tacShoot', unit: a.id, target: b.id })).toEqual({ ok: false, reason: 'no_ap' });
    expect(a.ammo).toBe(magOf(a));
  });

  it('перезарядка восстанавливает полный магазин и тратит BATTLE.ap.reload', () => {
    const { m, a } = shootScene({ ammo: 1 });
    const w = makeWorld(m);
    expect(applyTactical(w, { type: 'tacReload', unit: a.id })).toEqual({ ok: true });
    expect(a.ammo).toBe(magOf(a));
    expect(a.ap).toBe(2 - BATTLE.ap.reload);
    expect(m.log[m.log.length - 1]).toContain(a.name);
  });

  it('перезарядка при полном магазине и без ОД ничего не делает', () => {
    const full = shootScene();
    const wFull = makeWorld(full.m);
    expect(full.a.ammo).toBe(magOf(full.a));
    expect(applyTactical(wFull, { type: 'tacReload', unit: full.a.id })).toEqual({ ok: false, reason: 'nothing' });
    expect(full.a.ap).toBe(2);

    const noAp = shootScene({ ammo: 1, ap: 0 });
    const wNoAp = makeWorld(noAp.m);
    expect(applyTactical(wNoAp, { type: 'tacReload', unit: noAp.a.id })).toEqual({ ok: false, reason: 'nothing' });
    expect(noAp.a.ammo).toBe(1);
  });

  it('бесконечный магазин: выстрел не тратит патроны, перезарядка недоступна', () => {
    const m = makeMission();
    const alien = makeUnit(1, 'alien', 5, 5, { kind: 'Sectoid', ammo: 2, ap: 2 });
    const soldier = makeUnit(2, 'xcom', 5, 2);
    m.units = [soldier, alien];
    const w = makeWorld(m);
    expect(magOf(alien)).toBe(0);
    // Патроны у бесконечного оружия не меняются (сигнальное значение ловит списание в минус).
    shoot(w, m, alien, soldier);
    expect(alien.ammo).toBe(2);
    expect(alien.ap).toBe(2 - BATTLE.ap.shot);
    // Перезарядка бесконечного оружия (и вообще пришельца) недоступна.
    expect(applyTactical(w, { type: 'tacReload', unit: alien.id })).toEqual({ ok: false, reason: 'nothing' });
  });

  it('наблюдение и присед блокируют выстрел и перезарядку', () => {
    const { m, a, b } = shootScene({ ammo: 1 });
    const w = makeWorld(m);
    a.overwatch = true;
    expect(applyTactical(w, { type: 'tacShoot', unit: a.id, target: b.id })).toEqual({ ok: false, reason: 'busy' });
    expect(applyTactical(w, { type: 'tacReload', unit: a.id })).toEqual({ ok: false, reason: 'busy' });
    a.overwatch = false;
    a.hunkered = true;
    expect(applyTactical(w, { type: 'tacShoot', unit: a.id, target: b.id })).toEqual({ ok: false, reason: 'busy' });
    expect(applyTactical(w, { type: 'tacReload', unit: a.id })).toEqual({ ok: false, reason: 'busy' });
    expect(a.ammo).toBe(1);
    expect(a.ap).toBe(2);
  });

  it('списание патронов не мешает промаху бить по укрытию, а попаданию - щадить его', () => {
    const m = makeMission();
    const w = makeWorld(m);
    putProp(m, 5, 4, 'brick_wall');
    const shooter = makeUnit(1, 'xcom', 5, 2);
    const target = makeUnit(2, 'alien', 5, 5);
    m.units = [shooter, target];
    const chance = hitChance(m, shooter, target);
    const p = m.props[0];
    const hp = p.hp;

    w.rng = seedRng(seedWithRoll((r) => r < chance)); // попадание
    expect(shoot(w, m, shooter, target)).toBe(true);
    expect(p.hp).toBe(hp);
    expect(shooter.ammo).toBe(magOf(shooter) - 1);
    expect(shooter.ap).toBe(2 - BATTLE.ap.shot);

    shooter.ap = 2;
    shooter.ammo = magOf(shooter);
    w.rng = seedRng(seedWithRoll((r) => r >= chance)); // промах
    expect(shoot(w, m, shooter, target)).toBe(false);
    expect(p.hp).toBe(hp - envDamageOf(shooter));
    expect(shooter.ammo).toBe(magOf(shooter) - 1);
    expect(shooter.ap).toBe(2 - BATTLE.ap.shot);
  });

  it('реакция наблюдения может стрелять без траты ОД (costAp = false)', () => {
    const { m, a, b } = shootScene();
    const w = makeWorld(m);
    shoot(w, m, a, b, false);
    expect(a.ap).toBe(2);
    expect(a.ammo).toBe(magOf(a) - 1);
  });
});

describe('наблюдение и реакция на движение', () => {
  /** Наблюдатель-пришелец (конечный магазин) видит бойца-движущегося. */
  function owScene(over: Partial<TacUnit> = {}) {
    const m = makeMission();
    const mover = makeUnit(1, 'xcom', 5, 5);
    const watcher = makeUnit(2, 'alien', 5, 2, { kind: 'Muton', ammo: 3, overwatch: true, ...over });
    m.units = [mover, watcher];
    return { m, mover, watcher, w: makeWorld(m) };
  }

  it('tacOverwatch ставит флаг и тратит 1 ОД', () => {
    const m = makeMission();
    const s = makeUnit(1, 'xcom', 5, 5);
    m.units = [s];
    const w = makeWorld(m);
    expect(applyTactical(w, { type: 'tacOverwatch', unit: s.id })).toEqual({ ok: true });
    expect(s.overwatch).toBe(true);
    expect(s.ap).toBe(2 - BATTLE.ap.overwatch);
    expect(m.log[m.log.length - 1]).toContain(s.name);
  });

  it('tacOverwatch: без патронов - no_ammo, без ОД - no_ap, повторно - busy', () => {
    const m = makeMission();
    const s = makeUnit(1, 'xcom', 5, 5, { ammo: 0 });
    m.units = [s];
    const w = makeWorld(m);
    expect(applyTactical(w, { type: 'tacOverwatch', unit: s.id })).toEqual({ ok: false, reason: 'no_ammo' });
    expect(s.overwatch).toBe(false);

    s.ammo = 4;
    s.ap = 0;
    expect(applyTactical(w, { type: 'tacOverwatch', unit: s.id })).toEqual({ ok: false, reason: 'no_ap' });

    s.ap = 2;
    expect(applyTactical(w, { type: 'tacOverwatch', unit: s.id })).toEqual({ ok: true });
    expect(applyTactical(w, { type: 'tacOverwatch', unit: s.id })).toEqual({ ok: false, reason: 'busy' });
    expect(s.ap).toBe(2 - BATTLE.ap.overwatch); // второе нажатие ОД не списало
  });

  it('reactionChance: обычная - 0.7 от шанса, по рывку - 0.49', () => {
    const m = makeMission();
    const s = makeUnit(1, 'xcom', 5, 3, { aim: 65 }); // дистанция 2: шанс 80
    const t = makeUnit(2, 'alien', 5, 5);
    expect(hitChance(m, s, t)).toBe(80);
    expect(reactionChance(m, s, t, false)).toBe(56); // round(80 * 0.7)
    expect(reactionChance(m, s, t, true)).toBe(39); // round(80 * 0.49)
  });

  it('triggerOverwatch: наблюдатель видит движение - патрон минус один, флаг снят, ОД не тронуты', () => {
    const { m, mover, watcher, w } = owScene();
    const ap = watcher.ap;
    triggerOverwatch(w, m, mover, false);
    expect(watcher.ammo).toBe(2);
    expect(watcher.overwatch).toBe(false);
    expect(watcher.ap).toBe(ap);
    expect(m.log.some((l) => l.includes('реакция наблюдения'))).toBe(true);
  });

  it('повторный triggerOverwatch по тому же наблюдателю не стреляет', () => {
    const { m, mover, watcher, w } = owScene();
    triggerOverwatch(w, m, mover, false);
    const after = watcher.ammo;
    triggerOverwatch(w, m, mover, false);
    expect(watcher.ammo).toBe(after);
  });

  it('наблюдатель не видит движущегося - выстрела нет и флаг остаётся', () => {
    const m = makeMission();
    const mover = makeUnit(1, 'xcom', 5, 8);
    const watcher = makeUnit(2, 'alien', 5, 2, { kind: 'Muton', ammo: 3, overwatch: true });
    m.cells[5 * m.w + 5] = 2; // стена между ними перекрывает обзор
    m.units = [mover, watcher];
    const w = makeWorld(m);
    triggerOverwatch(w, m, mover, false);
    expect(watcher.ammo).toBe(3);
    expect(watcher.overwatch).toBe(true);
  });

  it('смерть движущегося прекращает очередь наблюдателей', () => {
    const m = makeMission();
    const mover = makeUnit(1, 'xcom', 5, 5, { hp: 1, maxHp: 1 });
    const first = makeUnit(2, 'alien', 5, 2, { kind: 'Muton', ammo: 3, overwatch: true, damage: [5, 5] });
    const second = makeUnit(3, 'alien', 5, 3, { kind: 'Muton', ammo: 3, overwatch: true });
    m.units = [mover, first, second];
    const w = makeWorld(m);
    const chance = reactionChance(m, first, mover, false);
    w.rng = seedRng(seedWithRoll((r) => r < chance)); // первый наблюдатель попадает и убивает
    triggerOverwatch(w, m, mover, false);
    expect(mover.hp).toBe(0);
    expect(first.ammo).toBe(2);
    expect(second.ammo).toBe(3); // второй наблюдатель не стрелял
    expect(second.overwatch).toBe(true);
  });

  it('startXcomTurn сбрасывает людей и не трогает пришельцев', () => {
    const m = makeMission();
    const s = makeUnit(1, 'xcom', 5, 5, { ap: 0, overwatch: true, hunkered: true, path: [[6, 5]] });
    const a = makeUnit(2, 'alien', 7, 7, { ap: 0, overwatch: true, hunkered: true, path: [[8, 7]] });
    m.units = [s, a];
    startXcomTurn(m);
    expect(s.ap).toBe(2);
    expect(s.overwatch).toBe(false);
    expect(s.hunkered).toBe(false);
    expect(s.path).toEqual([]);
    expect(a.ap).toBe(0);
    expect(a.overwatch).toBe(true);
    expect(a.hunkered).toBe(true);
    expect(a.path).toEqual([[8, 7]]);
  });

  it('ход бойца в пошаговом режиме вызывает реакцию наблюдателя-пришельца', () => {
    const m = makeMission();
    const mover = makeUnit(1, 'xcom', 5, 5);
    const watcher = makeUnit(2, 'alien', 5, 2, { kind: 'Muton', ammo: 3, overwatch: true });
    m.units = [mover, watcher];
    const w = makeWorld(m);
    expect(applyTactical(w, { type: 'tacMove', unit: mover.id, x: 5, y: 6 })).toEqual({ ok: true });
    expect(watcher.ammo).toBe(2);
    expect(watcher.overwatch).toBe(false);
    expect(mover.ap).toBe(1); // 2 - 1 за шаг; реакция ОД не тратит
  });

  it('перебежка пришельца вызывает реакцию наблюдателя-бойца', () => {
    const m = makeMission();
    const alien = makeUnit(1, 'alien', 1, 1, { kind: 'Muton', aim: 5, ammo: 3 });
    const soldier = makeUnit(2, 'xcom', 1, 10, { ammo: 4, overwatch: true });
    m.units = [alien, soldier];
    const w = makeWorld(m);
    alienTurn(w, m);
    expect(soldier.ammo).toBe(3);
    expect(soldier.overwatch).toBe(false);
    expect(soldier.ap).toBe(2); // реакция ОД не тратит
  });
});

describe('хункер (присед в укрытии)', () => {
  /** Боец в (5,5), пришелец восточнее - чтобы coverOf считался со стороны врага. */
  function hunkerScene(over: Partial<TacUnit> = {}) {
    const m = makeMission();
    const s = makeUnit(1, 'xcom', 5, 5, over);
    const a = makeUnit(2, 'alien', 8, 5);
    m.units = [s, a];
    return { m, s, a, w: makeWorld(m) };
  }

  it('tacHunker без соседнего укрытия - no_cover: флаг и ОД не тронуты', () => {
    const { m, s, w } = hunkerScene();
    expect(applyTactical(w, { type: 'tacHunker', unit: s.id })).toEqual({ ok: false, reason: 'no_cover' });
    expect(s.hunkered).toBe(false);
    expect(s.ap).toBe(2);
  });

  it('tacHunker без ОД - no_ap, даже если укрытие рядом', () => {
    const { m, s, w } = hunkerScene({ ap: 0 });
    putProp(m, 6, 5);
    expect(applyTactical(w, { type: 'tacHunker', unit: s.id })).toEqual({ ok: false, reason: 'no_ap' });
    expect(s.hunkered).toBe(false);
  });

  it('tacHunker в укрытии: флаг, ap = 0, coverOf 80, запись в журнал', () => {
    const { m, s, a, w } = hunkerScene({ path: [[6, 5]] });
    putProp(m, 6, 5, 'brick_wall'); // высокое укрытие 40
    expect(coverOf(m, s, a)).toBe(40);
    expect(applyTactical(w, { type: 'tacHunker', unit: s.id })).toEqual({ ok: true });
    expect(s.hunkered).toBe(true);
    expect(s.ap).toBe(0); // присед забирает все оставшиеся ОД
    expect(s.path).toEqual([]);
    expect(coverOf(m, s, a)).toBe(80); // 40 * BATTLE.hunkerMultiplier
    expect(m.log[m.log.length - 1]).toContain(s.name);
  });

  it('tacHunker удваивает половинное укрытие: 20 -> 40', () => {
    const { m, s, a, w } = hunkerScene();
    putProp(m, 6, 5, 'barrier'); // половинное укрытие 20
    expect(applyTactical(w, { type: 'tacHunker', unit: s.id })).toEqual({ ok: true });
    expect(coverOf(m, s, a)).toBe(40);
  });

  it('повторный присед и присед на наблюдении - busy', () => {
    const { m, s, w } = hunkerScene();
    putProp(m, 6, 5);
    expect(applyTactical(w, { type: 'tacHunker', unit: s.id })).toEqual({ ok: true });
    expect(applyTactical(w, { type: 'tacHunker', unit: s.id })).toEqual({ ok: false, reason: 'busy' });

    const ow = hunkerScene({ overwatch: true });
    putProp(ow.m, 6, 5);
    expect(applyTactical(ow.w, { type: 'tacHunker', unit: ow.s.id })).toEqual({ ok: false, reason: 'busy' });
    expect(ow.s.hunkered).toBe(false);
  });

  it('после хункера стрельба и наблюдение недоступны - busy', () => {
    const { m, s, a, w } = hunkerScene();
    putProp(m, 6, 5);
    expect(applyTactical(w, { type: 'tacHunker', unit: s.id })).toEqual({ ok: true });
    expect(applyTactical(w, { type: 'tacShoot', unit: s.id, target: a.id })).toEqual({ ok: false, reason: 'busy' });
    expect(applyTactical(w, { type: 'tacOverwatch', unit: s.id })).toEqual({ ok: false, reason: 'busy' });
    expect(a.hp).toBe(a.maxHp); // выстрела не было
    expect(s.overwatch).toBe(false);
    expect(s.ap).toBe(0);
  });

  it('присед сокращает обзор: sightOf 6, canSee на дистанции 8 - false', () => {
    const m = makeMission();
    const s = makeUnit(1, 'xcom', 1, 1);
    const a = makeUnit(2, 'alien', 1, 9); // дистанция 8
    m.units = [s, a];
    putProp(m, 2, 1); // соседнее укрытие для приседа
    const w = makeWorld(m);
    expect(canSee(m, s, a)).toBe(true);
    expect(applyTactical(w, { type: 'tacHunker', unit: s.id })).toEqual({ ok: true });
    expect(sightOf(s)).toBe(BATTLE.hunkerSightCells);
    expect(sightOf(s)).toBe(6);
    expect(canSee(m, s, a)).toBe(false);
  });

  it('tacHunker только для живого своего бойца в свой ход - иначе nothing', () => {
    const { m, s, a, w } = hunkerScene();
    putProp(m, 6, 5);
    expect(applyTactical(w, { type: 'tacHunker', unit: a.id })).toEqual({ ok: false, reason: 'nothing' });
    s.hp = 0;
    expect(applyTactical(w, { type: 'tacHunker', unit: s.id })).toEqual({ ok: false, reason: 'nothing' });
    s.hp = 10;
    m.phase = 'explore';
    expect(applyTactical(w, { type: 'tacHunker', unit: s.id })).toEqual({ ok: false, reason: 'nothing' });
    expect(s.hunkered).toBe(false);
  });

  it('startXcomTurn снимает присед и возвращает 2 ОД', () => {
    const { m, s, w } = hunkerScene();
    putProp(m, 6, 5);
    expect(applyTactical(w, { type: 'tacHunker', unit: s.id })).toEqual({ ok: true });
    startXcomTurn(m);
    expect(s.hunkered).toBe(false);
    expect(s.overwatch).toBe(false);
    expect(s.ap).toBe(2);
    expect(sightOf(s)).toBe(BATTLE.sightCells);
  });

  it('startAlienTurn снимает присед и наблюдение у пришельцев', () => {
    const m = makeMission();
    const a = makeUnit(1, 'alien', 5, 5, { ap: 0, overwatch: true, hunkered: true, path: [[6, 5]] });
    const s = makeUnit(2, 'xcom', 7, 7, { ap: 0, overwatch: true, hunkered: true, path: [[8, 7]] });
    m.units = [a, s];
    startAlienTurn(m);
    expect(a.ap).toBe(2);
    expect(a.overwatch).toBe(false);
    expect(a.hunkered).toBe(false);
    expect(a.path).toEqual([]);
    expect(s.ap).toBe(0); // людей не трогает
    expect(s.overwatch).toBe(true);
    expect(s.hunkered).toBe(true);
  });
});

// --- ИИ пришельцев (Task 8) ------------------------------------------------------------------

describe('ИИ пришельцев', () => {
  /** Большая карта, чтобы люди были вне обзора пришельца (дальность обзора 12). */
  const FAR = 28;

  it('пришелец с пустым магазином перезаряжается за ход', () => {
    const m = makeMission({ w: 30, h: 30 });
    const a = makeUnit(1, 'alien', 1, 1, { kind: 'Muton', ammo: 0, aim: 70 });
    const s = makeUnit(2, 'xcom', FAR, FAR, { ammo: 4 });
    m.units = [a, s];
    const w = makeWorld(m);
    alienTurn(w, m);
    expect(magOf(a)).toBe(3);
    expect(a.ammo).toBe(3); // пустой магазин пополнен
    expect(m.log.some((s) => s.includes('перезаряжается'))).toBe(true);
  });

  it('пришелец с 2 ОД и видимой целью делает два выстрела', () => {
    const m = makeMission();
    const a = makeUnit(1, 'alien', 1, 1, { kind: 'Muton', aim: 90, ammo: 3, damage: [1, 2] });
    const s = makeUnit(2, 'xcom', 1, 4, { hp: 10, maxHp: 10, ammo: 4 }); // дистанция 3, без укрытия
    m.units = [a, s];
    expect(hitChance(m, a, s)).toBeGreaterThanOrEqual(BATTLE.aiMinShotChance);
    const w = makeWorld(m, seedWithRoll(() => true));
    alienTurn(w, m);
    expect(a.ammo).toBe(1); // два выстрела из трёх патронов
    expect(a.ap).toBe(0);
    const shots = m.log.filter((s) => s.includes('попадает') || s.includes('промахивается')).length;
    expect(shots).toBe(2);
    expect(s.hp).toBeGreaterThan(0); // двух выстрелов мало, чтобы убить
  });

  it('раненый пришелец у укрытия приседает и заканчивает ход', () => {
    const m = makeMission();
    const a = makeUnit(1, 'alien', 5, 5, { kind: 'Muton', hp: 1, maxHp: 10, aim: 5, ammo: 3 });
    const s = makeUnit(2, 'xcom', 5, 10, { ammo: 4 }); // видим, но шанс ниже порога стрельбы
    m.units = [a, s];
    putProp(m, 6, 5, 'brick_wall'); // соседнее укрытие
    expect(hitChance(m, a, s)).toBeLessThan(BATTLE.aiMinShotChance);
    expect(a.hp).toBeLessThanOrEqual(a.maxHp * BATTLE.aiHunkerHpRatio);
    expect(hasAdjacentCover(m, a)).toBe(true);
    const w = makeWorld(m);
    alienTurn(w, m);
    expect(a.hunkered).toBe(true);
    expect(a.ap).toBe(0);
    expect(m.log.some((s) => s.includes('присел'))).toBe(true);
  });

  it('пришелец не входит в клетку с твёрдым пропсом', () => {
    const m = makeMission({ w: 30, h: 30 });
    const a = makeUnit(1, 'alien', 1, 1, { kind: 'Muton', aim: 70, ammo: 3 });
    const s = makeUnit(2, 'xcom', FAR, FAR, { ammo: 4 });
    m.units = [a, s];
    putProp(m, 2, 1, 'brick_wall'); // твёрдый пропс рядом
    const w = makeWorld(m);
    alienTurn(w, m);
    expect(a.x === 2 && a.y === 1).toBe(false);
    expect(m.props.some((p) => p.cell === a.y * m.w + a.x)).toBe(false);
  });

  it('без живых людей ход сразу выходит и не падает', () => {
    const m = makeMission();
    const a = makeUnit(1, 'alien', 5, 5, { kind: 'Muton', ammo: 3 });
    const s = makeUnit(2, 'xcom', 5, 6, { hp: 0 });
    m.units = [a, s];
    const w = makeWorld(m);
    alienTurn(w, m);
    expect(a.overwatch).toBe(false);
    expect(a.hunkered).toBe(false);
    expect(a.ap).toBe(2); // ход не начат
    expect(a.ammo).toBe(3);
  });

  it('гибель последнего человека прерывает ход пришельца', () => {
    const m = makeMission();
    const a = makeUnit(1, 'alien', 1, 1, { kind: 'Muton', aim: 95, ammo: 3, damage: [50, 50] });
    const s = makeUnit(2, 'xcom', 1, 2, { hp: 1, maxHp: 10 });
    m.units = [a, s];
    const w = makeWorld(m, seedWithRoll((roll) => roll < 95)); // первый бросок - попадание
    alienTurn(w, m);
    expect(s.hp).toBe(0);
    expect(a.ammo).toBe(2); // ровно один выстрел, дальше цель исчезла
    expect(a.overwatch).toBe(false);
  });
});

// --- Сохранение боя (Task 9) -----------------------------------------------------------------

/** Юнит в формате v5: без полей боя среза 2 (патроны, флаги, путь разведки). */
function unitV5(u: TacUnit): Record<string, unknown> {
  const copy: Record<string, unknown> = { ...u };
  delete copy.ammo;
  delete copy.overwatch;
  delete copy.hunkered;
  delete copy.path;
  delete copy.moveAcc;
  return copy;
}

/** Сохранение в формате v5: у миссии нет props, у юнитов - новых полей. */
function saveV5(w: World, mission: Mission | null): string {
  const { changes: _c, events: _e, fx: _f, ...rest } = w;
  const world: Record<string, unknown> = { ...rest, version: 5 };
  if (mission) {
    const { props: _props, ...missionRest } = mission;
    world.mission = { ...missionRest, units: mission.units.map(unitV5) };
  } else world.mission = null;
  return JSON.stringify({ format: 'avitown-save', saveVersion: 5, savedAt: new Date().toISOString(), world });
}

describe('сохранение боя', () => {
  it('текущая версия формата сохранения - 11', () => {
    expect(SAVE_VERSION).toBe(11);
  });

  it('бой с пропсами, патронами и флагами переживает сохранение и загрузку', () => {
    const w = createWorld(7);
    const m = makeMission({ phase: 'explore', turn: 3 });
    const s = makeUnit(1, 'xcom', 5, 5, { ammo: 1, ap: 0, overwatch: true, path: [[6, 5]], moveAcc: 2 });
    const a = makeUnit(2, 'alien', 5, 8, { kind: 'Muton', ammo: 2, hunkered: true });
    m.units = [s, a];
    putProp(m, 5, 4, 'brick_wall', 'broken');
    putProp(m, 6, 6, 'crate');
    m.log.push('выстрел');
    w.mission = m;

    const res = deserialize(serialize(w));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const lm = res.world.mission!;
    expect(lm).not.toBeNull();
    expect(lm.units).toEqual(m.units); // патроны, флаги, путь и разгон сохранены
    expect(lm.props).toEqual(m.props);
    expect(lm.phase).toBe('explore');
    expect(lm.turn).toBe(3);
    expect(lm.log).toEqual(['выстрел']);
  });

  it('старое сохранение v5: патроны по оружию, флаги false, props пуст', () => {
    const w = createWorld(5);
    const m = makeMission({ phase: 'turn', turn: 2 });
    m.units = [
      makeUnit(1, 'xcom', 5, 5),
      makeUnit(2, 'alien', 5, 8, { kind: 'Muton' }),
      makeUnit(3, 'alien', 6, 8, { kind: 'Sectoid' }), // бесконечное оружие - 0 патронов
      makeUnit(4, 'alien', 7, 8, { kind: 'Неизвестный' }), // нет в данных - запас по умолчанию
    ];
    putProp(m, 5, 4);

    const res = deserialize(saveV5(w, m));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const lm = res.world.mission!;
    expect(lm).not.toBeNull();
    expect(lm.props).toEqual([]); // пропсов в v5 не было
    expect(lm.phase).toBe('turn');
    expect(lm.turn).toBe(2);
    expect(lm.units.map((u) => u.ammo)).toEqual([SQUAD.soldier.mag, ALIEN_BY_ID.Muton.mag, 0, 4]);
    for (const u of lm.units) {
      expect(u.overwatch).toBe(false);
      expect(u.hunkered).toBe(false);
      expect(u.path).toEqual([]);
      expect(u.moveAcc).toBe(0);
    }
  });

  it('сохранение v5 без миссии загружается как раньше', () => {
    const w = createWorld(11);
    const res = deserialize(saveV5(w, null));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.world.mission).toBeNull();
    expect(hashWorld(res.world)).toBe(hashWorld(w));

    // Тот же случай, но поля mission в мире нет вовсе - подстановка по умолчанию.
    const file = JSON.parse(saveV5(w, null));
    delete file.world.mission;
    const noField = deserialize(JSON.stringify(file));
    expect(noField.ok).toBe(true);
    if (noField.ok) expect(noField.world.mission).toBeNull();
  });
});

