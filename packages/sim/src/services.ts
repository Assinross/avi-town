// Муниципальные улучшения: единственный источник уровней - definitions зданий.
// Не добавляем объекты симуляции или новый формат сохранения: используется Tile.level.
import type { BuildingDef } from '@avi/data';
import type { Tile } from './world';

export function municipalTier(def: BuildingDef, tile: Tile): number {
  const limit = def.municipalUpgrades?.prices.length ?? 0;
  return Number.isInteger(tile.level) ? Math.max(0, Math.min(limit, tile.level)) : 0;
}

export function municipalRadius(def: BuildingDef, tile: Tile): number {
  return def.municipalUpgrades?.radii[municipalTier(def, tile)] ?? def.service?.radius ?? 0;
}

export function municipalUpkeep(def: BuildingDef, tile: Tile): number {
  return def.upkeep + (def.municipalUpgrades?.extraUpkeep[municipalTier(def, tile)] ?? 0);
}

export function municipalHeal(def: BuildingDef, tile: Tile): number {
  return def.municipalUpgrades?.heal?.[municipalTier(def, tile)] ?? def.heal ?? 0;
}
