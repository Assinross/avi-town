import { ECONOMY } from '@avi/data';
import { builtLevel, CAPACITY, isFrontage, type CityEnv } from './city';
import { markChanged, type CivicState, type World } from './world';

const MOVE_IN_MOOD = 45;
export const REHOUSE_MOOD = 50;
const HARDSHIP_MOOD = 35;
const HARDSHIP_DAYS = 3;

/** Довольство по адресу: условия города плюс доступные услуги и соседи по кварталу. */
export function neighborhoodMood(w: World, i: number, env: CityEnv): number {
  const tile = w.tiles[i];
  const coverage = env.cover[i];
  const tax = (w.budget.tax - ECONOMY.tax.default) * ECONOMY.tax.happinessPerPoint;
  const mood = ECONOMY.happiness.base - tax - Math.min(40, w.hungerDays * 4)
    - Math.min(15, w.stats.unemployment / 4) - (env.polluted[i] ? ECONOMY.happiness.pollution : 0)
    - (tile.powered ? 0 : 25) - (tile.watered ? 0 : 20)
    + ((coverage & 1) ? 5 : 0) + ((coverage & 2) ? 10 : 0) + (env.nearJobs?.[i] ? 8 : 0);
  return Math.max(0, Math.min(100, Math.round(mood)));
}

/** Заселение и выселение считаются отдельно от стройки: готовый дом может пустовать. */
export function updateHousing(w: World, civic: CivicState, env: CityEnv) {
  const vacancies: { i: number; count: number; mood: number }[] = [];
  const displace = (i: number, count: number) => {
    if (!count) return;
    if (!civic.unhoused) civic.campCenter = i;
    civic.unhoused += count;
  };
  for (let i = 0; i < w.tiles.length; i++) {
    const t = w.tiles[i];
    const cap = t.object === 'zone' && t.zone === 'R' ? CAPACITY.R[builtLevel(t)] : 0;
    const prev = civic.homes[i];
    if (!cap) {
      if (prev) {
        displace(i, prev.residents);
        delete civic.homes[i];
      }
      continue;
    }
    const mood = neighborhoodMood(w, i, env);
    const home = prev ?? (civic.homes[i] = { residents: 0, hardship: 0 });
    displace(i, Math.max(0, home.residents - cap));
    home.residents = Math.min(home.residents, cap);
    home.hardship = home.residents && mood < HARDSHIP_MOOD ? Math.min(HARDSHIP_DAYS, home.hardship + 1) : 0;
    if (home.hardship === HARDSHIP_DAYS) {
      home.residents--;
      displace(i, 1);
    }
    if (t.build === 0 && home.residents < cap && mood >= MOVE_IN_MOOD && t.powered && t.watered) {
      vacancies.push({ i, count: Math.min(cap - home.residents, mood >= 60 ? 3 : 1), mood });
    }
  }

  vacancies.sort((a, b) => b.mood - a.mood);
  for (const vacancy of vacancies) {
    if (!civic.unhoused || vacancy.mood < REHOUSE_MOOD) break;
    const rehoused = Math.min(civic.unhoused, vacancy.count);
    civic.homes[vacancy.i].residents += rehoused;
    civic.unhoused -= rehoused;
    vacancy.count -= rehoused;
  }
  if (!civic.unhoused && w.stats.demand.R > 0) {
    for (const { i, count } of vacancies) civic.homes[i].residents += count;
  }
  updateCamps(w, civic);

  let housed = 0, residentBase = 0, moodTotal = 0, lostWork = 0;
  for (const [key, { residents }] of Object.entries(civic.homes)) {
    const i = Number(key);
    const mood = neighborhoodMood(w, i, env);
    housed += residents;
    residentBase += residents * ECONOMY.residentTax[builtLevel(w.tiles[i])];
    moodTotal += residents * mood;
    // Пропуски работы из-за болезней и стресса уменьшают налоги с труда.
    lostWork += residents * Math.max(0, 60 - mood);
  }
  const population = housed + civic.unhoused;
  civic.incomeLoss = housed ? Math.round(lostWork / housed) : 0;
  return { housed, population, residentBase, happiness: population ? Math.round((moodTotal + civic.unhoused * 20) / population) : null };
}

/** Палатки занимают свободные обочины рядом с кварталом, где люди потеряли жильё. */
function updateCamps(w: World, civic: CivicState) {
  const camps: Record<number, number> = {};
  if (civic.unhoused > 0) {
    const x = civic.campCenter % w.size, y = Math.floor(civic.campCenter / w.size);
    const spots: { i: number; score: number }[] = [];
    w.tiles.forEach((t, i) => {
      if (t.object !== 'none' || (t.terrain !== 'soil' && t.terrain !== 'wasteland')) return;
      const tx = i % w.size, ty = Math.floor(i / w.size);
      const score = Math.abs(tx - x) + Math.abs(ty - y) + (isFrontage(w, tx, ty) ? 0 : w.size);
      spots.push({ i, score });
    });
    spots.sort((a, b) => a.score - b.score);
    const count = Math.min(12, spots.length, Math.ceil(civic.unhoused / 4));
    for (let k = 0; k < count; k++) {
      camps[spots[k].i] = Math.floor((civic.unhoused + k) / count);
    }
  } else civic.campCenter = -1;
  for (const i of Object.keys(civic.camps)) if (!camps[Number(i)]) markChanged(w, Number(i));
  for (const i of Object.keys(camps)) if (camps[Number(i)] !== civic.camps[Number(i)]) markChanged(w, Number(i));
  civic.camps = camps;
}
