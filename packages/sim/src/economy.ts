// Экономика города: налоги и расходы копятся в бюджет недели, в первый день новой недели переходят
// в казну одним отчётом. Долг больше предела несколько недель подряд - банкротство, конец игры.

import { ECONOMY } from '@avi/data';
import { emptyLedger, type ExpenseItem, type IncomeItem, type WeekReport, type World, type ZoneType } from './world';

/** Итоги дня для бюджета: базы налогов (сотые доли ¢ при ставке 10%) и расходы в ¢. */
export interface DayTotals {
  /** Налог со всех жителей, если бы все работали, - по уровням домов. */
  residentBase: number;
  pop: number;
  jobs: Record<ZoneType, number>;
  buildings: number;
  defense: number;
  roads: number;
  squad: number;
}

/** Работники, занятые и безработица (%) по числу жителей и рабочих мест. */
export function employment(pop: number, jobs: number) {
  const workers = Math.floor((pop * ECONOMY.workShare) / 100);
  const employed = Math.min(workers, jobs);
  return { workers, employed, unemployment: workers ? Math.floor(((workers - employed) * 100) / workers) : 0 };
}

/** Начислить день в бюджет недели; возвращает доход и расход дня в ¢ для прогноза. */
export function accrueDay(w: World, d: DayTotals): { income: number; upkeep: number } {
  const b = w.budget;
  const jobs = d.jobs.C + d.jobs.I + d.jobs.A;
  const { employed } = employment(d.pop, jobs);
  const rate = b.tax;
  // Налог платят только занятые жители и занятые рабочие места
  const taxR = d.pop ? Math.floor((d.residentBase * employed * rate) / (d.pop * 10)) : 0;
  const job = (z: 'C' | 'I' | 'A') => (jobs ? Math.floor((d.jobs[z] * ECONOMY.jobTax[z] * employed * rate) / (jobs * 10)) : 0);
  const income: Record<IncomeItem, number> = { taxR, taxC: job('C'), taxI: job('I'), taxA: job('A'), metal: 0 };
  const expense: Record<ExpenseItem, number> = {
    buildings: d.buildings * 100,
    defense: d.defense * 100,
    services: d.pop * ECONOMY.services.perResident + jobs * ECONOMY.services.perJob,
    roads: d.roads * 100,
    squad: d.squad * 100,
    interest: 0,
  };
  let inc = 0, exp = 0;
  for (const k of Object.keys(income) as IncomeItem[]) { b.income[k] += income[k]; inc += income[k]; }
  for (const k of Object.keys(expense) as ExpenseItem[]) { b.expense[k] += expense[k]; exp += expense[k]; }
  return { income: Math.floor(inc / 100), upkeep: Math.ceil(exp / 100) };
}

/** Закрыть неделю: продать излишки металла, перевести бюджет в казну, начислить проценты, проверить банкротство. */
export function closeWeek(w: World, week: number) {
  const b = w.budget;
  const excess = w.resources.metal - ECONOMY.metal.storage;
  if (excess > 0) {
    w.resources.metal = ECONOMY.metal.storage;
    b.income.metal += excess * ECONOMY.metal.price * 100;
  }
  const income = {} as Record<IncomeItem, number>;
  const expense = {} as Record<ExpenseItem, number>;
  let net = 0;
  for (const k of Object.keys(b.income) as IncomeItem[]) { income[k] = Math.floor(b.income[k] / 100); net += income[k]; }
  for (const k of Object.keys(b.expense) as ExpenseItem[]) { expense[k] = Math.floor(b.expense[k] / 100); net -= expense[k]; }
  w.money += net;
  if (w.money < 0) {
    expense.interest = Math.ceil((-w.money * ECONOMY.debt.interest) / 100);
    w.money -= expense.interest;
    net -= expense.interest;
  }
  b.debtWeeks = w.money < -ECONOMY.debt.limit ? b.debtWeeks + 1 : 0;
  const report: WeekReport = { week, income, expense, net, unemployment: w.stats.unemployment, debtWeeks: b.debtWeeks };
  b.last = report;
  Object.assign(b, emptyLedger());
  w.events.push({ type: 'weekReport', report });
  if (b.debtWeeks >= ECONOMY.debt.weeks) {
    w.over = 'bankrupt';
    w.speed = 0;
    w.events.push({ type: 'bankrupt' });
  }
}

export function clampTax(rate: number): number {
  return Math.max(ECONOMY.tax.min, Math.min(ECONOMY.tax.max, Math.round(rate)));
}
