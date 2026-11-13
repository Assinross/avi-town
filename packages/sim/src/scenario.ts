// Три честных сценария старта. Выбор от сида не расходует генератор случайных чисел,
// поэтому одна и та же карта и экономический старт воспроизводятся при повторной игре.
import { SCENARIOS } from '@avi/data';
import type { CampaignScenario, World } from './world';

const scenarioIds = ['frontier', 'salvage', 'science'] as const satisfies readonly CampaignScenario[];

export function scenarioForSeed(seed: number): CampaignScenario {
  // Смешиваем биты сида; новая игра с тем же сидом всегда получает тот же сценарий.
  let value = seed >>> 0;
  value ^= value >>> 16;
  value = Math.imul(value, 0x7feb352d);
  value ^= value >>> 15;
  return scenarioIds[(value >>> 0) % scenarioIds.length];
}

/** Применять строго один раз при создании новой кампании, не при загрузке сохранения. */
export function startScenario(w: World) {
  if (!w.campaign || w.civic || w.campaign.scenario) return;
  const id = scenarioForSeed(w.seed);
  const def = SCENARIOS[id];
  w.campaign.scenario = id;
  w.money = Math.max(0, w.money + def.money);
  w.resources.metal = Math.max(0, w.resources.metal + def.metal);
  w.food = Math.max(0, w.food + def.food);
  w.research.archives += def.archives;
  w.campaign.threat = Math.max(0, Math.min(100, w.campaign.threat + def.threat));
  w.campaign.threatDelta = def.threat;
  w.campaign.threatReason = 'Начальные условия: ' + def.name;
  w.journal.push({ day: w.day, kind: 'intel', severity: 'info',
    text: 'Стартовый сценарий: ' + def.name + '. ' + def.description });
  w.revision++;
}
