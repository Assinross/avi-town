// Данные игры: определения зданий, исследований, НЛО и тексты.
// Баланс правится здесь, а не в коде ядра (конституция, принцип III).

import buildingsJson from './defs/buildings.json';
import techsJson from './defs/techs.json';
import ufosJson from './defs/ufos.json';
import ruOwn from './locale/ru.json';
import ruXcom from './locale/ru.xcom.json';

export type Resource = 'money' | 'metal' | 'alloys' | 'elerium' | 'fragments';
export type Cost = Partial<Record<Resource, number>>;

export interface BuildingDef {
  id: string;
  nameKey: string;
  category: 'utility' | 'industry' | 'xcom' | 'defense';
  size: number;
  hp: number;
  cost: Cost;
  upkeep: number;
  hint: string;
  needsPower?: boolean;
  requires?: string;
  terrain?: string[];
  power?: number;
  water?: { river: number; well: number };
  metalPerDay?: number;
  research?: number;
  radar?: boolean;
  aa?: { range: number; damage: number; cooldown: number; accuracy: number };
}

export interface TechDef {
  id: string;
  cost: number;
  requires: string[];
  items: Partial<Record<'alloys' | 'elerium' | 'fragments', number>>;
}

export interface UfoDef {
  id: string;
  nameKey: string;
  fromDay: number;
  hp: number;
  ticksPerTile: number;
  weapon: { range: number; cooldown: number };
  salvage: Partial<Record<Resource, number>>;
}

export const BUILDINGS = buildingsJson as BuildingDef[];
export const BUILDING_BY_ID: Record<string, BuildingDef> = Object.fromEntries(BUILDINGS.map((b) => [b.id, b]));
export const TECHS = techsJson as TechDef[];
export const TECH_BY_ID: Record<string, TechDef> = Object.fromEntries(TECHS.map((t) => [t.id, t]));
export const UFOS = ufosJson as UfoDef[];
export const UFO_BY_ID: Record<string, UfoDef> = Object.fromEntries(UFOS.map((u) => [u.id, u]));

const TEXT: Record<string, string> = { ...ruXcom, ...ruOwn };

/** Текст по ключу; неизвестный ключ возвращается как есть, чтобы его было видно. */
export function t(key: string): string {
  return TEXT[key] ?? key;
}

export const techName = (id: string) => t(`xcom.tech.${id}`);
export const techDesc = (id: string) => TEXT[`xcom.techDesc.${id}`] ?? '';
