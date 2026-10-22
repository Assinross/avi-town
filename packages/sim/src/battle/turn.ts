// Пошаговые ходы боя: команды игрока, ИИ пришельцев, итог миссии.

import { BATTLE, COVER_BY_ID, UFO_BY_ID, t } from '@avi/data'; // t - названия укрытий в журнале
import { removeCrash } from '../commands';
import { nextInt } from '../rng';
import { woundHeal } from '../squad';
import type { World } from '../world';
import { CELLS, EXPLORE_TICKS_PER_CELL, type CoverProp, type Mission, type TacCommand, type TacResult, type TacUnit } from './types';
import { canSee, coverOf, coverPropOf, dist, distances, envDamageOf, hasAdjacentCover, hitChance, magOf, moveCost, occupied, pathTo, reactionChance } from './rules';

export function log(m: Mission, text: string) {
  m.log.push(text);
  if (m.log.length > 6) m.log.shift();
}

/** Мировые координаты (сотые доли клетки города) центра боевой клетки - для эффектов. */
export function fxPos(m: Mission, x: number, y: number) {
  return { x: ((m.ox + x + 0.5) * 100) / CELLS, y: ((m.oy + y + 0.5) * 100) / CELLS };
}

/**
 * Урон укрытию: состояние по остатку запаса прочности, при смене - запись в журнал,
 * взрыв на клетке пропса и рост ревизии. Только от промаха по цели за этим укрытием.
 */
export function damageProp(w: World, m: Mission, p: CoverProp, amount: number): void {
  p.hp = Math.max(0, p.hp - amount);
  const ratio = p.hp / p.maxHp;
  const state = ratio <= BATTLE.collapseRatio ? 'collapsed' : ratio <= BATTLE.breakRatio ? 'broken' : 'whole';
  if (state === p.state) return;
  p.state = state;
  log(m, `${t(COVER_BY_ID[p.kind].nameKey)} ${state === 'collapsed' ? 'рухнуло' : 'пробито'}`);
  w.fx.push({ type: 'explosion', ...fxPos(m, p.cell % m.w, Math.floor(p.cell / m.w)), big: state === 'collapsed' });
  w.revision++;
}

/**
 * Выстрел: тратит патрон (кроме бесконечного оружия) и `BATTLE.ap.shot` ОД.
 * `costAp = false` нужен реакции наблюдения: она стреляет без траты ОД.
 * `chance` позволяет подменить шанс попадания (реакция наблюдения стреляет урезанным шансом).
 */
export function shoot(w: World, m: Mission, a: TacUnit, b: TacUnit, costAp = true, chance = hitChance(m, a, b)): boolean {
  if (magOf(a) > 0) a.ammo = Math.max(0, a.ammo - 1);
  const hit = nextInt(w.rng, 100) < chance;
  const from = fxPos(m, a.x, a.y), to = fxPos(m, b.x, b.y);
  w.fx.push({ type: 'tacShot', fromX: from.x, fromY: from.y, toX: to.x, toY: to.y, hit, alien: a.side === 'alien', fromId: a.id, toId: b.id });
  if (hit) {
    const dmg = a.damage[0] + nextInt(w.rng, a.damage[1] - a.damage[0] + 1);
    b.hp = Math.max(0, b.hp - dmg);
    // Боец XCOM не гибнет: при нуле здоровья он тяжело ранен и выбывает до конца боя
    const down = b.side === 'xcom' ? `, ${b.name.replace(' (вы)', '')}: тяжёлое ранение, выбывает из боя` : ', цель уничтожена';
    log(m, `${a.side === 'xcom' ? a.name : 'Пришелец'} попадает (${chance}%): -${dmg}${b.hp === 0 ? down : ''}`);
    if (b.hp === 0 && b.side === 'alien') w.fx.push({ type: 'explosion', x: to.x, y: to.y, big: false });
  } else {
    // Промах уходит в укрытие цели со стороны стрелка и разрушает его.
    const cover = coverPropOf(m, b, a);
    log(m, `${a.side === 'xcom' ? a.name : 'Пришелец'} промахивается (${chance}%)${cover ? ': попадание ушло в укрытие' : ''}`);
    if (cover) damageProp(w, m, cover, envDamageOf(a));
  }
  if (costAp) a.ap = Math.max(0, a.ap - BATTLE.ap.shot);
  return hit;
}

/**
 * Реакция наблюдения: живые наблюдатели противоположной стороны с флагом, патронами и обзором
 * стреляют по движущемуся по очереди (по id). Флаг снимается до выстрела, ОД не тратятся,
 * каждый выстрел тратит патрон. Смерть движущегося прекращает очередь.
 */
export function triggerOverwatch(w: World, m: Mission, mover: TacUnit, dashed: boolean): void {
  const watchers = m.units
    .filter((u) => u.side !== mover.side && u.hp > 0 && u.overwatch && (magOf(u) === 0 || u.ammo > 0) && canSee(m, u, mover))
    .sort((a, b) => a.id - b.id);
  for (const watcher of watchers) {
    if (mover.hp <= 0) break;
    watcher.overwatch = false;
    log(m, `${watcher.side === 'xcom' ? watcher.name : 'Пришелец'}: реакция наблюдения`);
    shoot(w, m, watcher, mover, false, reactionChance(m, watcher, mover, dashed));
  }
}

export function checkEnd(w: World, m: Mission) {
  if (!m.units.some((u) => u.side === 'alien' && u.hp > 0)) {
    m.phase = 'result';
    m.result = 'win';
    log(m, 'Все пришельцы уничтожены. Место крушения под контролем');
  } else if (!m.units.some((u) => u.side === 'xcom' && u.hp > 0)) {
    m.phase = 'result';
    m.result = 'lose';
    log(m, 'Весь отряд тяжело ранен - эвакуация');
  }
}

export function contact(m: Mission): boolean {
  const xcom = m.units.filter((u) => u.side === 'xcom' && u.hp > 0);
  return m.units.some((a) => a.side === 'alien' && a.hp > 0 && xcom.some((s) => canSee(m, s, a)));
}

/** Начало хода людей: полные ОД, без наблюдения и хункера. Пришельцев не трогает - у них свой ход. */
export function startXcomTurn(m: Mission) {
  for (const u of m.units) {
    if (u.side !== 'xcom' || u.hp <= 0) continue;
    u.ap = 2;
    u.overwatch = false;
    u.hunkered = false;
    u.path = [];
  }
}

/** Начало хода пришельцев: полные ОД, без наблюдения и хункера. */
export function startAlienTurn(m: Mission) {
  for (const u of m.units) {
    if (u.side !== 'alien' || u.hp <= 0) continue;
    u.ap = 2;
    u.overwatch = false;
    u.hunkered = false;
    u.path = [];
  }
}

export function applyTactical(w: World, cmd: TacCommand): TacResult {
  const m = w.mission;
  if (!m) return { ok: false, reason: 'no_mission' };
  w.revision++;
  switch (cmd.type) {
    case 'tacFinish':
      if (m.phase !== 'result') return { ok: false, reason: 'not_your_turn' };
      finish(w, m);
      return { ok: true };
    case 'tacRetreat':
      m.phase = 'result';
      m.result = 'retreat';
      log(m, 'Отряд отступил');
      return { ok: true };
    case 'tacReload': {
      const u = m.units.find((x) => x.id === cmd.unit);
      if (m.phase !== 'turn' || !u || u.side !== 'xcom' || u.hp <= 0) return { ok: false, reason: 'nothing' };
      if (u.overwatch || u.hunkered) return { ok: false, reason: 'busy' };
      const mag = magOf(u);
      // Полный или бесконечный магазин, либо не хватает ОД - команда не делает ничего.
      if (mag <= 0 || u.ammo >= mag || u.ap < BATTLE.ap.reload) return { ok: false, reason: 'nothing' };
      u.ammo = mag;
      u.ap -= BATTLE.ap.reload;
      log(m, `${u.name} перезаряжается`);
      return { ok: true };
    }
    case 'tacOverwatch': {
      const u = m.units.find((x) => x.id === cmd.unit);
      if (m.phase !== 'turn' || !u || u.side !== 'xcom' || u.hp <= 0) return { ok: false, reason: 'nothing' };
      if (u.overwatch || u.hunkered) return { ok: false, reason: 'busy' };
      if (magOf(u) > 0 && u.ammo === 0) return { ok: false, reason: 'no_ammo' };
      if (u.ap < BATTLE.ap.overwatch) return { ok: false, reason: 'no_ap' };
      u.overwatch = true;
      u.ap -= BATTLE.ap.overwatch;
      log(m, `${u.name} на наблюдении`);
      return { ok: true };
    }
    case 'tacHunker': {
      const u = m.units.find((x) => x.id === cmd.unit);
      if (m.phase !== 'turn' || !u || u.side !== 'xcom' || u.hp <= 0) return { ok: false, reason: 'nothing' };
      if (u.overwatch || u.hunkered) return { ok: false, reason: 'busy' };
      if (u.ap < BATTLE.ap.hunker) return { ok: false, reason: 'no_ap' };
      // Присед возможен только у соседнего укрытия: без него боец не получает защиты.
      if (!hasAdjacentCover(m, u)) return { ok: false, reason: 'no_cover' };
      u.hunkered = true;
      u.ap = 0; // присед забирает все оставшиеся ОД
      u.path = [];
      log(m, `${u.name} присел в укрытии`);
      return { ok: true };
    }
    case 'tacEndTurn':
      if (m.phase !== 'turn') return { ok: false, reason: 'not_your_turn' };
      alienTurn(w, m);
      checkEnd(w, m);
      if (m.phase === 'turn') {
        m.turn++;
        startXcomTurn(m);
        log(m, `Ход ${m.turn}`);
      }
      return { ok: true };
    case 'tacMove': {
      const u = m.units.find((x) => x.id === cmd.unit);
      if (!u || u.side !== 'xcom' || u.hp <= 0) return { ok: false, reason: 'dead' };
      if (m.phase === 'explore') {
        const path = pathTo(m, u, cmd.x, cmd.y);
        if (!path || !path.length) return { ok: false, reason: 'unreachable' };
        u.path = path;
        u.moveAcc = 0;
        return { ok: true };
      }
      if (m.phase !== 'turn') return { ok: false, reason: 'not_your_turn' };
      const cost = moveCost(m, u, cmd.x, cmd.y);
      if (cost < 0) return { ok: false, reason: 'unreachable' };
      if (cost > u.ap) return { ok: false, reason: 'no_ap' };
      u.x = cmd.x;
      u.y = cmd.y;
      u.ap -= cost;
      // Наблюдатели-пришельцы реагируют на движение (по рывку - урезанный шанс).
      triggerOverwatch(w, m, u, cost === BATTLE.ap.dash);
      checkEnd(w, m);
      return { ok: true };
    }
    case 'tacShoot': {
      if (m.phase !== 'turn') return { ok: false, reason: 'not_your_turn' };
      const a = m.units.find((x) => x.id === cmd.unit), b = m.units.find((x) => x.id === cmd.target);
      if (!a || !b || a.hp <= 0 || b.hp <= 0 || a.side !== 'xcom' || b.side !== 'alien') return { ok: false, reason: 'dead' };
      if (a.overwatch || a.hunkered) return { ok: false, reason: 'busy' };
      if (magOf(a) > 0 && a.ammo === 0) return { ok: false, reason: 'no_ammo' };
      if (a.ap < BATTLE.ap.shot) return { ok: false, reason: 'no_ap' };
      if (!canSee(m, a, b)) return { ok: false, reason: 'no_los' };
      shoot(w, m, a, b);
      checkEnd(w, m);
      return { ok: true };
    }
  }
}

/** Тик боя: движение в режиме разведки и переход в пошаговый режим при контакте. */
export function tacticalTick(w: World) {
  const m = w.mission;
  if (!m || m.phase !== 'explore') return;
  let moved = false;
  for (const u of m.units) {
    if (u.side !== 'xcom' || !u.path.length) continue;
    if (++u.moveAcc < EXPLORE_TICKS_PER_CELL) continue;
    u.moveAcc = 0;
    const [nx, ny] = u.path[0];
    // Конечная клетка занята (туда пришёл другой боец) - останавливаемся перед ней
    if (u.path.length === 1 && occupied(m, nx, ny, u)) {
      u.path = [];
      continue;
    }
    u.path.shift();
    u.x = nx;
    u.y = ny;
    moved = true;
  }
  if (moved) w.revision++;
  if (contact(m)) {
    m.phase = 'turn';
    scamper(w, m);
    startXcomTurn(m);
    log(m, 'Контакт! Пришельцы заметили отряд и бросились в укрытия. Ход 1');
    w.revision++;
  }
}

// --- ИИ пришельцев ---------------------------------------------------------------------------

/**
 * Перебежка в клетку с лучшим укрытием от ближайшего бойца.
 * scamper - рывок при обнаружении (как в XCOM): только укрытие, не сближаясь.
 */
export function coverMove(w: World, m: Mission, a: TacUnit, scamper: boolean) {
  const enemies = m.units.filter((u) => u.side === 'xcom' && u.hp > 0);
  if (!enemies.length) return;
  const d = distances(m, a, a.mobility);
  let bestCell = -1, bestScore = -1e9;
  for (let i = 0; i < d.length; i++) {
    if (d[i] < 0 || d[i] > a.mobility || occupied(m, i % m.w, Math.floor(i / m.w), a)) continue;
    // Пробник без текущего хункера, иначе он удвоил бы бонус укрытия при оценке.
    const probe: TacUnit = { ...a, x: i % m.w, y: Math.floor(i / m.w), hunkered: false };
    const nearest = enemies.reduce((p, s) => (dist(s, probe) < dist(p, probe) ? s : p));
    const cover = enemies.reduce((c, s) => Math.min(c, coverOf(m, probe, s)), 40);
    const score = scamper
      ? cover * 3 + coverOf(m, probe, nearest) - Math.abs(dist(probe, nearest) - 8) + nextInt(w.rng, 3)
      : coverOf(m, probe, nearest) * 2 - dist(probe, nearest) + nextInt(w.rng, 4);
    if (score > bestScore) { bestScore = score; bestCell = i; }
  }
  if (bestCell >= 0) {
    a.x = bestCell % m.w;
    a.y = Math.floor(bestCell / m.w);
  }
}

/** Пришельцы при обнаружении разбегаются по укрытиям. */
export function scamper(w: World, m: Mission) {
  for (const a of m.units) if (a.side === 'alien' && a.hp > 0) coverMove(w, m, a, true);
}

export function alienTurn(w: World, m: Mission) {
  startAlienTurn(m);
  const xcom = () => m.units.filter((u) => u.side === 'xcom' && u.hp > 0);
  // Лучшая видимая цель по шансу попадания.
  const best = (a: TacUnit) => {
    let target: TacUnit | null = null, chance = 0;
    for (const s of xcom()) {
      if (!canSee(m, a, s)) continue;
      const c = hitChance(m, a, s);
      if (c > chance) { chance = c; target = s; }
    }
    return { target, chance };
  };
  for (const a of m.units) {
    if (a.side !== 'alien' || a.hp <= 0) continue;
    // Пустой магазин - перезарядка до начала действий.
    if (magOf(a) > 0 && a.ammo === 0) {
      a.ammo = magOf(a);
      a.ap = Math.max(0, a.ap - BATTLE.ap.reload);
      log(m, 'Пришелец перезаряжается');
    }
    let shots = 0; // не больше двух выстрелов за ход
    let shot = best(a);
    if (shot.target && shot.chance >= BATTLE.aiMinShotChance) {
      // Хороший шанс - стрельба с места, цель перевыбирается после каждой смерти.
      while (shots < 2 && a.ap >= BATTLE.ap.shot && (magOf(a) === 0 || a.ammo > 0)) {
        const target = best(a).target;
        if (!target) break;
        shoot(w, m, a, target);
        shots++;
        if (!xcom().length) break;
      }
      if (!xcom().length) break;
      continue;
    }
    if (!xcom().length) break;
    // Раненый пришелец у укрытия приседает и заканчивает ход.
    if (a.hp <= a.maxHp * BATTLE.aiHunkerHpRatio && hasAdjacentCover(m, a)) {
      a.hunkered = true;
      a.ap = 0;
      log(m, 'Пришелец присел в укрытии');
      continue;
    }
    // Перебежка в клетку с лучшим укрытием; наблюдатели-люди реагируют только на фактическое движение.
    const fromX = a.x, fromY = a.y;
    coverMove(w, m, a, false);
    if (a.x !== fromX || a.y !== fromY) triggerOverwatch(w, m, a, false);
    if (a.hp <= 0) continue;
    a.ap = Math.max(0, a.ap - BATTLE.ap.move);
    // После перебежки - выстрел по слабому шансу, иначе наблюдение.
    shot = best(a);
    if (shot.target && shot.chance >= BATTLE.aiMinShotChanceAfterMove) {
      while (shots < 2 && a.ap >= BATTLE.ap.shot && (magOf(a) === 0 || a.ammo > 0)) {
        const target = best(a).target;
        if (!target) break;
        shoot(w, m, a, target);
        shots++;
        if (!xcom().length) break;
      }
    } else if (a.ap >= BATTLE.ap.overwatch && (magOf(a) === 0 || a.ammo > 0)) {
      a.overwatch = true;
      a.ap -= BATTLE.ap.overwatch;
      log(m, 'Пришелец на наблюдении');
    }
    if (!xcom().length) break;
  }
}

// --- Итог ------------------------------------------------------------------------------------

export function finish(w: World, m: Mission) {
  // Никто не гибнет: раненые уезжают лечиться, тяжело раненые (здоровье 0) - надолго
  let wounded = 0, down = 0;
  for (const u of m.units) {
    const sol = u.side === 'xcom' ? w.soldiers.find((s) => s.id === u.soldier) : undefined;
    if (!sol) continue;
    sol.heal = woundHeal(u.hp);
    if (u.hp <= 0) down++;
    else if (sol.heal > 0) wounded++;
  }
  if (m.result === 'win') {
    const salvage = UFO_BY_ID[m.ufo]?.salvage ?? {};
    w.money += salvage.money ?? 0;
    w.resources.alloys += salvage.alloys ?? 0;
    w.resources.elerium += salvage.elerium ?? 0;
    w.resources.fragments += salvage.fragments ?? 0;
    const nest = m.site !== undefined ? w.sites.find((x) => x.id === m.site) : undefined;
    if (nest) {
      nest.done = true;
      w.events.push({ type: 'nestCleared', salvage, wounded, down });
    } else {
      removeCrash(w);
      w.events.push({ type: 'crashCleared', ufo: m.ufo, salvage, wounded, down });
    }
  } else {
    w.events.push({ type: 'missionFailed', ufo: m.ufo, wounded, down, retreat: m.result === 'retreat' });
  }
  // Броневик забирает отряд и едет обратно тем же путём
  const c = w.convoy;
  if (c) {
    c.path.reverse();
    c.seg = 0;
    c.acc = 0;
    c.phase = 'back';
  }
  w.mission = null;
  w.revision++;
}
