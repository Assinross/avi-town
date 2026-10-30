// Генератор зданий из деталей (plan.md 010, этап 5): рецепты типов домов из общих деталей (parts.ts) -
// домик и барак (R1), двухэтажный дом (R2), кирпичный дом 3-5 этажей (R3), лавка с витриной (C1),
// дом с магазинами в первом этаже и универмаг (C2-C3), мастерская, склад и цех (промзона), школа и лазарет,
// электростанция и водокачка, лаборатории трёх ярусов и радар.
// По умолчанию включены (?fx=-buildings - прежние модели KayKit и Kenney для сравнения).

import { fxFlags } from '../../platform/device';

export { brickHouse } from './brick';
export { cottageHouse } from './cottage';
export { twoStoreyHouse } from './house';
export { shopFront } from './shop';
export { departmentStore, shopHouse } from './storefront';
export { brickWorkshop, factoryHall, warehouse } from './industry';
export { clinicBuilding, schoolBuilding } from './services';
export { powerPlant, pumpStation } from './utilities';
export { labBuilding, radarStation } from './research';
export type { Frame } from './parts';

let detailed = fxFlags.buildings;
/** Включить или выключить детальные дома (по умолчанию - флаг ?fx=buildings). */
export function setDetailedBuildings(on: boolean) {
  detailed = on;
}
export const detailedBuildings = () => detailed;
