// Отладочный прогон графа полос (только dev): структура полос и манёвров плюс пробные
// маршруты между местами города. Вызывается из консоли: avi.checkLanes().

import type { World } from '@avi/sim';
import type { CityMap } from '../render/cityMap';
import { checkLanes } from '../render/laneGraph';

/** Отчёт по графу полос: ошибки структуры, счёт манёвров и результат пробных маршрутов. */
export function laneReport(w: World, map: CityMap): string[] {
  const g = map.laneGraph;
  const lines: string[] = [];
  const turns = new Map<string, number>();
  for (const m of g.maneuvers) turns.set(m.turn, (turns.get(m.turn) ?? 0) + 1);
  lines.push(`полос: ${g.lanes.length}, манёвров: ${g.maneuvers.length}`);
  lines.push(`манёвры: ${[...turns].map(([turn, n]) => `${turn} ${n}`).join(', ') || 'нет'}`);
  const errors = checkLanes(w, g);
  if (errors.length) {
    lines.push(`ошибок: ${errors.length}`);
    lines.push(...errors.slice(0, 20));
  }
  // Пробные маршруты: от каждого дома в ближайшие магазины и на работы
  let ok = 0, fail = 0;
  const targets = [...map.shops.slice(0, 4), ...map.jobs.slice(0, 4)];
  for (const from of map.homes.slice(0, 12)) {
    for (const to of targets) {
      const route = g.route(from.road, to.road);
      if (route && g.plan(route, from.road, to.road)) ok++;
      else fail++;
    }
  }
  lines.push(`маршрутов: ${ok} есть, ${fail} нет`);
  return lines;
}
