// Город с проспектом (только dev): эталонный город, у которого улица y=18 заменена
// проспектом 2+2 (пара клеток 18-19). Вызывается из консоли: avi.avenueCity().

import { applyCommand, serialize } from '@avi/sim';
import { buildBenchCity } from './benchCity';

const SAVE_KEY = 'avi-town.save';

/** Собрать город с проспектом, сохранить и открыть на 8 утра. */
export function avenueCity() {
  const w = buildBenchCity();
  applyCommand(w, { type: 'bulldoze', rect: { x0: 1, y0: 17, x1: 62, y1: 20 } });
  for (let x = 2; x <= 61; x++) applyCommand(w, { type: 'buildRoad', x, y: 18, pair: { x, y: 19 }, avenue: true });
  for (const x of [5, 14, 23, 32, 41, 50, 59]) for (const y of [17, 20]) applyCommand(w, { type: 'buildRoad', x, y });
  const data = serialize(w);
  localStorage.setItem(SAVE_KEY, data);
  window.addEventListener('beforeunload', () => localStorage.setItem(SAVE_KEY, data));
  const url = new URL(location.href);
  url.searchParams.set('hour', '8');
  url.searchParams.set('sandbox', '');
  location.href = url.toString();
}
