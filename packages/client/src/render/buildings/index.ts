// Генератор зданий из деталей (plan.md 010, этап 5): рецепты типов домов из общих деталей (parts.ts) -
// кирпичный дом 3-5 этажей (R3), двухэтажный дом (R2), лавка с витриной (C1); только на срезе ?slice.

export { brickHouse } from './brick';
export { twoStoreyHouse } from './house';
export { shopFront } from './shop';
export type { Frame } from './parts';

let detailed = false;
/** Включить детальные дома вместо моделей KayKit (срез). */
export function setDetailedBuildings(on: boolean) {
  detailed = on;
}
export const detailedBuildings = () => detailed;
