// Отряд XCOM между миссиями - ранения как в Jagged Alliance 2: никто не гибнет, но раненые
// выбывают на время лечения. Лечение идёт по дням, лазарет ускоряет его (Stats.healRate).
// Здоровье бойца не хранится отдельно - оно выводится из оставшихся очков лечения.

import { SQUAD, UPGRADE_BY_ID, WASTELAND } from '@avi/data';
import type { Soldier, World } from './world';

/** Личный боец игрока - первый в составе, его не уволить. */
export const PERSONAL_ID = 1;

export function initialSquad(): Soldier[] {
  return Array.from({ length: SQUAD.size }, (_, k) => ({ id: k + 1, name: SQUAD.names[k % SQUAD.names.length], heal: 0 }));
}

/** Очки лечения после боя: дни за каждую потерянную единицу здоровья, сверху - за тяжёлое ранение. */
export function woundHeal(hp: number): number {
  const lost = SQUAD.soldier.hp - Math.max(0, Math.min(hp, SQUAD.soldier.hp));
  return lost * SQUAD.heal.daysPerHp + (hp <= 0 ? SQUAD.heal.downDays : 0);
}

/** Текущее здоровье: восстанавливается по единице за daysPerHp очков лечения. */
export function soldierHp(s: Soldier): number {
  return Math.max(0, SQUAD.soldier.hp - Math.ceil(s.heal / SQUAD.heal.daysPerHp));
}

export const isReady = (s: Soldier) => s.heal <= 0;

/** Бойцы, которые сейчас вне бункера: в броневике или в экспедиции. */
export function awaySoldiers(w: World): Set<number> {
  const out = new Set<number>(w.convoy?.soldiers ?? []);
  for (const e of w.expeditions ?? []) for (const id of e.soldiers) out.add(id);
  return out;
}

/** Здоровые бойцы на месте, в бункере: их можно отправить на миссию или в экспедицию. */
export function readySoldiers(w: World): Soldier[] {
  const away = awaySoldiers(w);
  return w.soldiers.filter((s) => isReady(s) && !away.has(s.id));
}

/** Прибавка оружейной бункера к меткости и урону бойцов. */
export function armoryBonus(w: World): { aim: number; damage: number } {
  let aim = 0, damage = 0;
  for (const id of w.bunker?.upgrades ?? []) {
    aim += UPGRADE_BY_ID[id]?.aim ?? 0;
    damage += UPGRADE_BY_ID[id]?.damage ?? 0;
  }
  return { aim, damage };
}

/** Сколько бойцов вмещает казарма бункера; без бункера - предел из данных отряда. */
export function rosterCap(w: World): number {
  if (!w.bunker) return SQUAD.maxRoster;
  return w.bunker.upgrades.reduce((n, id) => n + (UPGRADE_BY_ID[id]?.roster ?? 0), WASTELAND.bunker.roster);
}

/** Сколько дней до выздоровления при текущей скорости лечения. */
export function daysToHeal(w: World, s: Soldier): number {
  return Math.ceil(s.heal / Math.max(1, w.stats.healRate));
}

/** Ежедневное лечение; rate - во сколько раз быстрее обычного. */
export function squadDay(w: World, rate: number) {
  for (const s of w.soldiers) {
    if (s.heal <= 0) continue;
    s.heal = Math.max(0, s.heal - rate);
    if (s.heal === 0) w.events.push({ type: 'soldierRecovered', name: s.name });
  }
}

/** Зарплата запасных: платят за каждого бойца сверх штатного состава. */
export function squadUpkeep(w: World): number {
  return Math.max(0, w.soldiers.length - SQUAD.size) * SQUAD.salary;
}

/** Новый боец: свободное имя из списка, id - следующий после самого большого. */
export function newSoldier(w: World): Soldier {
  const used = new Set(w.soldiers.map((s) => s.name));
  const id = w.soldiers.reduce((max, s) => Math.max(max, s.id), 0) + 1;
  const name = SQUAD.names.find((n) => !used.has(n)) ?? `Боец ${id}`;
  return { id, name, heal: 0 };
}
