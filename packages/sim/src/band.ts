// Кочующие банды: мутанты из пустоши (позже и пришельцы) приходят пешком к ближайшему дому и громят
// дома вокруг, жители разбегаются. Отряд выезжает на броневике, бой - автоматический (fight.ts).
// Отряд проиграл - банда больше не ломает дома, но держит горожан в страхе, пока не уйдёт.

import { ALIEN_BY_ID, WASTELAND } from '@avi/data';
import { cityCenter, findTarget, hit } from './raid';
import { nextInt } from './rng';
import type { Band, Fiend, World } from './world';

const B = WASTELAND.bands;

/** Выключатель банд (как raidConfig у налётов). */
export const bandConfig = { enabled: true };

/** Пауза до следующей банды: со временем короче, не меньше minGap. */
export function bandGap(w: World): number {
  const shrink = Math.floor((w.day * B.gapShrinkPerYear) / 360);
  return Math.max(B.minGap, B.gap[0] + nextInt(w.rng, B.gap[1] - B.gap[0] + 1) - shrink);
}

/** Состав банды: растёт со временем, у мутантов позже появляются громилы. */
function crew(w: World, kind: Band['kind']): Fiend[] {
  const n = Math.min(B.maxSize, B.size[0] + nextInt(w.rng, B.size[1] - B.size[0] + 1) + Math.floor(w.day / B.growEvery));
  const out: Fiend[] = [];
  for (let k = 0; k < n; k++) {
    let id: string;
    if (kind === 'aliens') id = B.aliens.crew[k % B.aliens.crew.length];
    else id = w.day >= B.mutants.heavyFromDay && k % B.mutants.heavyEvery === B.mutants.heavyEvery - 1 ? B.mutants.heavy : B.mutants.crew[k % B.mutants.crew.length];
    out.push({ kind: id, hp: ALIEN_BY_ID[id].hp });
  }
  return out;
}

/** Точка появления: суша в пустоши на расстоянии spawnDistance от города. */
function spawnPoint(w: World, cx: number, cy: number): { x: number; y: number } | null {
  for (let attempt = 0; attempt < 16; attempt++) {
    const a = (nextInt(w.rng, 360) * Math.PI) / 180;
    const r = B.spawnDistance[0] + nextInt(w.rng, B.spawnDistance[1] - B.spawnDistance[0] + 1);
    const x = Math.max(1, Math.min(w.size - 2, Math.round(cx + Math.cos(a) * r)));
    const y = Math.max(1, Math.min(w.size - 2, Math.round(cy + Math.sin(a) * r)));
    const t = w.tiles[y * w.size + x];
    if (t.terrain !== 'water' && t.object !== 'building' && !(t.object === 'zone' && t.level > 0)) return { x, y };
  }
  return null;
}

/** Ежедневно: банда уходит по сроку, новая выходит из пустоши. */
export function bandDay(w: World) {
  const b = w.band;
  if (b) {
    if (b.arrived && w.day >= b.leaveDay && w.fight?.target !== 'band') {
      w.band = null;
      w.nextBandDay = w.day + bandGap(w);
      w.events.push({ type: 'bandLeft', kind: b.kind });
      w.revision++;
    }
    return;
  }
  if (!bandConfig.enabled || w.day < w.nextBandDay) return;
  const c = cityCenter(w);
  const p = c ? spawnPoint(w, c.x, c.y) : null;
  if (!p) {
    w.nextBandDay = w.day + 5;
    return;
  }
  const kind: Band['kind'] = w.day >= B.aliens.fromDay && nextInt(w.rng, 100) < B.aliens.chance ? 'aliens' : 'mutants';
  w.band = { kind, x: p.x * 100 + 50, y: p.y * 100 + 50, members: crew(w, kind), target: -1, timer: B.hitTicks, arrived: false, terror: false, leaveDay: 0 };
  w.events.push({ type: 'bandSpotted', kind, count: w.band.members.length });
  w.revision++;
}

/** Клетка ещё стоит: дом с уровнем или здание. */
function standing(w: World, i: number): boolean {
  const t = w.tiles[i];
  return !!t && (t.object === 'building' || (t.object === 'zone' && t.level > 0));
}

/** Тик банды: идёт к цели, у цели - бьёт дом. Пока с ней бьётся отряд - стоит. */
export function bandTick(w: World) {
  const b = w.band!;
  if (w.fight?.target === 'band') return;
  const bx = Math.floor(b.x / 100), by = Math.floor(b.y / 100);
  if (b.target < 0 || !standing(w, b.target)) {
    // Новая цель: в городе - ближайший дом рядом, по пути - ближайший вообще
    b.target = findTarget(w, bx, by, b.arrived ? B.radius : w.size);
    if (b.target < 0) {
      if (b.arrived) b.leaveDay = w.day; // громить больше нечего - уйдёт в конце дня
      return;
    }
  }
  const tx = (b.target % w.size) * 100 + 50, ty = Math.floor(b.target / w.size) * 100 + 50;
  const dx = tx - b.x, dy = ty - b.y;
  const len = Math.sqrt(dx * dx + dy * dy);
  // Банда встаёт у дома, а не в нём
  if (len > 70) {
    const speed = Math.max(1, Math.round(100 / B.ticksPerCell));
    b.x += Math.round((dx * speed) / len);
    b.y += Math.round((dy * speed) / len);
    return;
  }
  if (!b.arrived) {
    b.arrived = true;
    b.leaveDay = w.day + B.days;
    w.events.push({ type: 'bandArrived', kind: b.kind, count: b.members.length });
    w.speed = 0; // время решить, высылать ли отряд
    w.revision++;
  }
  if (b.terror || --b.timer > 0) return;
  b.timer = B.hitTicks;
  w.fx.push({ type: 'fightShot', fromX: b.x, fromY: b.y, toX: tx, toY: ty, hit: true, alien: true, from: w.tick % b.members.length, to: -1 });
  w.fx.push({ type: 'explosion', x: tx, y: ty, big: false });
  hit(w, b.target);
  w.revision++;
}

/** Минус к довольству от банды в городе. */
export function bandMood(w: World): number {
  const b = w.band;
  if (!b?.arrived) return 0;
  return b.terror ? B.terrorMood : B.mood;
}
