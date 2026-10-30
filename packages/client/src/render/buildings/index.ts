// Генератор зданий из деталей (plan.md 010, этап 5): рецепты типов домов. Пока один образец -
// кирпичный дом 3-5 этажей на участке многоэтажки (R3); включается только на срезе ?slice.

export { brickHouse, type Frame } from './brick';

let detailed = false;
/** Включить детальные дома вместо моделей KayKit (срез). */
export function setDetailedBuildings(on: boolean) {
  detailed = on;
}
export const detailedBuildings = () => detailed;
