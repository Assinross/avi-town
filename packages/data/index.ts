// Данные игры: определения зданий, исследований, НЛО и тексты.
// Баланс правится здесь, а не в коде ядра (конституция, принцип III).

import buildingsJson from './defs/buildings.json';
import techsJson from './defs/techs.json';
import ufosJson from './defs/ufos.json';
import aliensJson from './defs/aliens.json';
import squadJson from './defs/squad.json';
import battleJson from './defs/battle.json';
import coverJson from './defs/cover.json';
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
  /** Сколько игровых дней идёт стройка. */
  buildDays: number;
  hint: string;
  needsPower?: boolean;
  requires?: string;
  terrain?: string[];
  power?: number;
  water?: { river: number; well: number };
  metalPerDay?: number;
  research?: number;
  /** Ярус лаборатории: открывает исследования своего уровня. */
  labTier?: number;
  radar?: boolean;
  aa?: { range: number; damage: number; cooldown: number; accuracy: number };
}

export interface TechDef {
  id: string;
  cost: number;
  /** Денежная цена при старте исследования. */
  price: number;
  /** Минимальный ярус лаборатории, где можно изучать. */
  lab: number;
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
  crew: string[];
}

export interface AlienDef {
  id: string;
  nameKey: string;
  hp: number;
  aim: number;
  mobility: number;
  damage: [number, number];
  color: string;
  mag: number;
  envDamage: number;
}

export interface SquadDef {
  size: number;
  soldier: { hp: number; aim: number; mobility: number; damage: [number, number]; weaponKey: string; armorKey: string; mag: number; envDamage: number };
  sightCells: number;
  replacementCost: number;
  names: string[];
}

export interface BattleRules {
  coverLow: number;
  coverHigh: number;
  hunkerMultiplier: number;
  overwatchAim: number;
  dashOverwatchAim: number;
  sightCells: number;
  hunkerSightCells: number;
  aiMinShotChance: number;
  aiMinShotChanceAfterMove: number;
  aiHunkerHpRatio: number;
  ap: { shot: number; move: number; dash: number; reload: number; overwatch: number; hunker: number };
  propCount: number;
  breakRatio: number;
  collapseRatio: number;
  propClearRadius: number;
}

export interface CoverDef {
  id: string;
  nameKey: string;
  model: string;
  debris: string;
  cover: 20 | 40;
  hp: number;
  solid: boolean;
  height: number;
  weight: number;
}

export const BUILDINGS = buildingsJson as BuildingDef[];
export const BUILDING_BY_ID: Record<string, BuildingDef> = Object.fromEntries(BUILDINGS.map((b) => [b.id, b]));
export const TECHS = techsJson as TechDef[];
export const TECH_BY_ID: Record<string, TechDef> = Object.fromEntries(TECHS.map((t) => [t.id, t]));
export const UFOS = ufosJson as UfoDef[];
export const UFO_BY_ID: Record<string, UfoDef> = Object.fromEntries(UFOS.map((u) => [u.id, u]));

export const ALIENS = aliensJson as AlienDef[];
export const ALIEN_BY_ID: Record<string, AlienDef> = Object.fromEntries(ALIENS.map((a) => [a.id, a]));
export const SQUAD = squadJson as SquadDef;

export const BATTLE = battleJson as BattleRules;
export const COVERS = coverJson as CoverDef[];
export const COVER_BY_ID: Record<string, CoverDef> = Object.fromEntries(COVERS.map((c) => [c.id, c]));

const TEXT: Record<string, string> = { ...ruXcom, ...ruOwn };

/** Текст по ключу; неизвестный ключ возвращается как есть, чтобы его было видно. */
export function t(key: string): string {
  return TEXT[key] ?? key;
}

export const techName = (id: string) => t(`xcom.tech.${id}`);
export const techDesc = (id: string) => TEXT[`xcom.techDesc.${id}`] ?? '';
