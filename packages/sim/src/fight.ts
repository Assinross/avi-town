// Автобой на общей карте: броневик доехал - отряд и враги перестреливаются в реальном времени,
// пока одна из сторон не выбыла. Город при этом живёт. Чем выше звание бойцов и лучше оружейная,
// тем чаще они попадают и реже получают ранения. Никто не гибнет: проигравший отряд эвакуируют
// тяжело раненым.

import { ALIEN_BY_ID, SQUAD, UFO_BY_ID, WASTELAND, type Cost } from '@avi/data';
import { removeCrash } from './commands';
import { nextInt, seedRng, type RngState } from './rng';
import { armoryBonus, rankOf, soldierHp, woundHeal } from './squad';
import { bandGap } from './band';
import type { Fight, Fighter, Fx, Soldier, World } from './world';

const F = SQUAD.fight;

/** Укрытие врагов у тарелки и в гнезде: обломки и норы. Банда на улице стоит открыто. */
const ENEMY_COVER: Record<Fight['target'], number> = { crash: 15, nest: 15, band: 0 };

function soldierFighter(w: World, s: Soldier): Fighter {
  const rank = SQUAD.ranks[rankOf(s)];
  const arm = armoryBonus(w);
  const d = SQUAD.soldier.damage;
  return {
    soldier: s.id, hp: soldierHp(s), maxHp: SQUAD.soldier.hp, aim: SQUAD.soldier.aim + rank.aim + arm.aim,
    damage: [d[0] + arm.damage, d[1] + arm.damage], guard: rank.guard + F.cover, cooldown: 0,
  };
}

function enemyFighter(kind: string, hp: number | undefined, cover: number): Fighter {
  const def = ALIEN_BY_ID[kind] ?? ALIEN_BY_ID.Sectoid;
  return { kind, hp: hp ?? def.hp, maxHp: def.hp, aim: def.aim, damage: [...def.damage] as [number, number], guard: cover, cooldown: 0 };
}

/** Где стоит k-й стрелок стороны - в сотых долях клетки. Отряд - цепью у броневика, враги - кольцом. */
export function fighterPos(f: Fight, side: 'squad' | 'enemy', k: number): { x: number; y: number } {
  if (side === 'squad') {
    const n = f.squad.length;
    // Цепь поперёк направления на врага
    const dx = f.x - f.fromX, dy = f.y - f.fromY;
    const len = Math.hypot(dx, dy) || 1;
    const off = (k - (n - 1) / 2) * 16;
    return { x: Math.round(f.fromX - (dy / len) * off), y: Math.round(f.fromY + (dx / len) * off) };
  }
  const n = f.enemies.length;
  const a = (k / Math.max(1, n)) * Math.PI * 2;
  const r = n > 1 ? 22 : 0;
  return { x: Math.round(f.x + Math.cos(a) * r), y: Math.round(f.y + Math.sin(a) * r) };
}

/** Собрать бой: кто против кого. Цель уже проверена вызывающим. */
export function makeFight(w: World, target: Fight['target'], at: { x: number; y: number }, from: { x: number; y: number }, team: Soldier[], site?: number): Fight {
  let enemies: Fighter[];
  let ufo: string | undefined;
  if (target === 'band') {
    enemies = w.band!.members.map((m) => enemyFighter(m.kind, m.hp, ENEMY_COVER.band));
  } else {
    ufo = target === 'nest' ? WASTELAND.sites.nest.ufo : w.crash!.ufo;
    enemies = (UFO_BY_ID[ufo]?.crew ?? ['Sectoid']).map((k) => enemyFighter(k, undefined, ENEMY_COVER[target]));
  }
  const f: Fight = { target, x: at.x, y: at.y, fromX: from.x, fromY: from.y, squad: team.map((s) => soldierFighter(w, s)), enemies };
  if (ufo) f.ufo = ufo;
  if (site !== undefined) f.site = site;
  // Первые выстрелы вразнобой, чтобы перестрелка не шла залпами
  for (const x of [...f.squad, ...f.enemies]) x.cooldown = 1 + nextInt(w.rng, F.cooldown[1]);
  return f;
}

/** Начать автобой. at/from - клетки цели и подъезда броневика. */
export function startFight(w: World, target: Fight['target'], at: { x: number; y: number }, from: { x: number; y: number }, team: Soldier[], site?: number) {
  const c = (v: { x: number; y: number }) => ({ x: v.x * 100 + 50, y: v.y * 100 + 50 });
  // Банда стоит не по центру клетки - бой там, где она сейчас
  const pos = target === 'band' && w.band ? { x: w.band.x, y: w.band.y } : c(at);
  w.fight = makeFight(w, target, pos, c(from), team, site);
  w.events.push({ type: 'fightStarted', target });
  w.revision++;
}

const alive = (list: Fighter[]) => list.filter((x) => x.hp > 0);

/** Один тик перестрелки; fx - куда складывать выстрелы (null - без эффектов, для прикидки шансов). */
function fightStep(f: Fight, rng: RngState, fx: Fx[] | null): 'win' | 'lose' | null {
  const sides: [Fighter[], Fighter[], 'squad' | 'enemy'][] = [[f.squad, f.enemies, 'squad'], [f.enemies, f.squad, 'enemy']];
  for (const [mine, theirs, side] of sides) {
    mine.forEach((a, k) => {
      if (a.hp <= 0 || --a.cooldown > 0) return;
      a.cooldown = F.cooldown[0] + nextInt(rng, F.cooldown[1] - F.cooldown[0] + 1);
      const targets = alive(theirs);
      if (!targets.length) return;
      const t = targets[nextInt(rng, targets.length)];
      const chance = Math.max(F.minChance, Math.min(F.maxChance, a.aim - t.guard));
      const hit = nextInt(rng, 100) < chance;
      if (hit) t.hp -= a.damage[0] + nextInt(rng, a.damage[1] - a.damage[0] + 1);
      if (fx) {
        const from = fighterPos(f, side, k);
        const to = fighterPos(f, side === 'squad' ? 'enemy' : 'squad', theirs.indexOf(t));
        fx.push({ type: 'fightShot', fromX: from.x, fromY: from.y, toX: to.x, toY: to.y, hit, alien: side === 'enemy' });
      }
    });
  }
  if (!alive(f.enemies).length) return 'win';
  if (!alive(f.squad).length) return 'lose';
  return null;
}

/** Тик автобоя в мире. */
export function fightTick(w: World) {
  const f = w.fight!;
  const res = fightStep(f, w.rng, w.fx);
  if (res) finishFight(w, res === 'win');
  else if (w.tick % 5 === 0) w.revision++; // полоски здоровья в панели боя
}

function addLoot(w: World, loot: Cost, times = 1) {
  w.money += (loot.money ?? 0) * times;
  w.resources.metal += (loot.metal ?? 0) * times;
  w.resources.alloys += (loot.alloys ?? 0) * times;
  w.resources.elerium += (loot.elerium ?? 0) * times;
  w.resources.fragments += (loot.fragments ?? 0) * times;
}

const scale = (loot: Cost, n: number): Cost => Object.fromEntries(Object.entries(loot).map(([k, v]) => [k, (v ?? 0) * n]));

function finishFight(w: World, win: boolean) {
  const f = w.fight!;
  // Раны: победителям - по полученному урону, проигравших эвакуируют в тяжёлом состоянии
  let wounded = 0, down = 0;
  for (const x of f.squad) {
    const sol = w.soldiers.find((s) => s.id === x.soldier);
    if (!sol) continue;
    sol.heal = woundHeal(win ? x.hp : 0);
    if (!win || x.hp <= 0) down++;
    else if (sol.heal > 0) wounded++;
    const before = rankOf(sol);
    sol.xp = (sol.xp ?? 0) + (win ? F.xpWin : F.xpLoss);
    const after = rankOf(sol);
    if (after > before) w.events.push({ type: 'rankUp', name: sol.name, rank: after });
  }
  if (f.target === 'band') {
    const band = w.band;
    if (win) {
      const kind = band?.kind ?? 'mutants';
      const salvage = scale(WASTELAND.bands[kind].trophy, f.enemies.length);
      addLoot(w, salvage);
      w.band = null;
      w.nextBandDay = w.day + bandGap(w);
      w.events.push({ type: 'bandCleared', kind, salvage, wounded, down });
    } else if (band) {
      // Выжившие остаются и держат город в страхе, но дома больше не ломают
      band.members = f.enemies.filter((x) => x.hp > 0).map((x) => ({ kind: x.kind!, hp: x.hp }));
      band.terror = true;
      w.events.push({ type: 'fightLost', target: 'band', down });
    }
  } else if (win) {
    const salvage = UFO_BY_ID[f.ufo!]?.salvage ?? {};
    addLoot(w, salvage);
    const nest = f.site !== undefined ? w.sites.find((x) => x.id === f.site) : undefined;
    if (nest) {
      nest.done = true;
      w.events.push({ type: 'nestCleared', salvage, wounded, down });
    } else {
      if (w.crash) removeCrash(w);
      w.events.push({ type: 'crashCleared', ufo: f.ufo!, salvage, wounded, down });
    }
  } else {
    w.events.push({ type: 'fightLost', target: f.target, down });
  }
  // Броневик забирает отряд и едет обратно тем же путём
  const c = w.convoy;
  if (c) {
    c.path.reverse();
    c.seg = 0;
    c.acc = 0;
    c.phase = 'back';
  }
  w.fight = null;
  w.revision++;
}

/**
 * Прикидка исхода: тот же бой разыгрывается много раз на отдельном ГСЧ, мир не меняется.
 * win - шанс победы в %, wounded - сколько бойцов в среднем вернутся ранеными.
 */
export function fightOdds(w: World, target: Fight['target'], team: Soldier[], runs = 40): { win: number; wounded: number } {
  if (!team.length || (target === 'band' && !w.band) || (target === 'crash' && !w.crash)) return { win: 0, wounded: 0 };
  const at = target === 'band' ? { x: Math.floor(w.band!.x / 100), y: Math.floor(w.band!.y / 100) } : target === 'crash' ? w.crash! : { x: 0, y: 0 };
  const rng = seedRng((w.seed ^ (w.day * 7919)) >>> 0);
  const probe: World = { ...w, rng };
  const base = makeFight(probe, target, at, at, team);
  let wins = 0, hurt = 0;
  for (let r = 0; r < runs; r++) {
    const f: Fight = { ...base, squad: base.squad.map((x) => ({ ...x })), enemies: base.enemies.map((x) => ({ ...x })) };
    let res: 'win' | 'lose' | null = null;
    for (let t = 0; t < 20000 && !res; t++) res = fightStep(f, rng, null);
    if (res === 'win') {
      wins++;
      hurt += f.squad.filter((x) => x.hp < x.maxHp).length;
    } else hurt += f.squad.length;
  }
  return { win: Math.round((wins * 100) / runs), wounded: Math.round((hurt * 10) / runs) / 10 };
}
