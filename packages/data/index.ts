// Данные игры: определения зданий, исследований, НЛО и тексты.
// Баланс правится здесь, а не в коде ядра (конституция, принцип III).

import buildingsJson from './defs/buildings.json';
import techsJson from './defs/techs.json';
import ufosJson from './defs/ufos.json';
import aliensJson from './defs/aliens.json';
import squadJson from './defs/squad.json';
import battleJson from './defs/battle.json';
import coverJson from './defs/cover.json';
import economyJson from './defs/economy.json';
import wastelandJson from './defs/wasteland.json';
import ruOwn from './locale/ru.json';
import ruXcom from './locale/ru.xcom.json';

export type Resource = 'money' | 'metal' | 'alloys' | 'elerium' | 'fragments';
export type Cost = Partial<Record<Resource, number>>;

export interface BuildingDef {
  id: string;
  nameKey: string;
  category: 'utility' | 'industry' | 'service' | 'xcom' | 'defense';
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
  /** Во сколько раз быстрее лечатся раненые бойцы, пока здание работает. */
  heal?: number;
  /** Услуга для жителей в радиусе (клеток от здания): школа, больница - нужны домам 3-го уровня. */
  service?: { kind: ServiceKind; radius: number };
  aa?: { range: number; damage: number; cooldown: number; accuracy: number };
  /** Ставит генератор карты: игрок не строит и не сносит (бункер). */
  fixed?: boolean;
  /** Отсюда выезжает броневик отряда (бункер, застава). */
  garage?: boolean;
}

export type ServiceKind = 'education' | 'health';

/** Баланс экономики. Налоги и расходы на жителя - в сотых долях ¢ в день (налоги - при ставке 10%). */
export interface EconomyDef {
  startMoney: number;
  /** Ставка налога в процентах; каждый процент выше default снимает happinessPerPoint довольства, ниже - добавляет. */
  tax: { default: number; min: number; max: number; happinessPerPoint: number };
  /** Доля работающих жителей, %. */
  workShare: number;
  /** Налог с занятого жителя по уровню дома 0..3. */
  residentTax: number[];
  /** Налог с занятого рабочего места по типу зоны. */
  jobTax: { C: number; I: number; A: number };
  /** Расходы города на услуги: на каждого жителя и рабочее место. */
  services: { perResident: number; perJob: number };
  /** Одна монета содержания в день на столько клеток дороги. */
  roadsPerUpkeep: number;
  /** Проценты на долг в неделю, предел долга (¢) и сколько недель подряд сверх предела - банкротство. */
  debt: { interest: number; limit: number; weeks: number };
  /** Довольство: база, потолки штрафов за безработицу и загрязнение, прибавка за услуги, порог 3-го уровня. */
  happiness: { base: number; unemploymentMax: number; pollution: number; services: number; level3: number };
  /** Радиус загрязнения, доля еды ферм в загрязнении (%), радиус отравления земли и шанс "1 из N" в день на клетку промзоны 3-го уровня. */
  pollution: { radius: number; farmFood: number; poisonRadius: number; poisonChance: number };
  /** Склад металла; излишки продаются в конце недели по price ¢ за единицу. */
  metal: { storage: number; price: number };
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
  /** Шанс в процентах, что после атаки тарелка не улетит, а высадит десант в городе. */
  landChance: number;
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
  /** Меньше здоровых бойцов - отряд не вызвать. */
  minSquad: number;
  /** Больше бойцов в составе не нанять. */
  maxRoster: number;
  hireCost: number;
  /** Зарплата в день за каждого бойца сверх size. */
  salary: number;
  /** Лечение: дней на единицу здоровья и сверх того за тяжёлое ранение (здоровье 0). */
  heal: { daysPerHp: number; downDays: number };
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

/** Улучшение бункера: строится days дней, добавляет содержание и свой эффект. */
export interface BunkerUpgradeDef {
  id: string;
  /** Сначала нужно это улучшение. */
  after?: string;
  /** Сначала нужно это исследование. */
  tech?: string;
  cost: Cost;
  upkeep: number;
  days: number;
  /** Мест в казарме сверх базовых. */
  roster?: number;
  /** Прибавка к скорости лечения бойцов. */
  heal?: number;
  /** Броневик быстрее по дорогам и бездорожью. */
  fast?: boolean;
  /** Радар в бункере: налёт замечен заранее. */
  radar?: boolean;
  /** На сколько клеток шире открыт туман вокруг бункера. */
  reveal?: number;
  /** Радиус убежища: попадания по жилью рядом с бункером часто гасятся. */
  shelter?: number;
  /** Оружейная: прибавка к меткости и урону бойцов. */
  aim?: number;
  damage?: number;
}

export type SiteKind = 'metal' | 'spring' | 'cache' | 'archive' | 'survivors' | 'radiation' | 'nest';

/** Пустошь после войны: бункер, туман, разведка, находки, руины, десант. Расстояния - в клетках. */
export interface WastelandDef {
  /** Радиусы, на которые отступает туман: вокруг бункера на старте, дороги, постройки, радара, места падения, броневика в пути. */
  reveal: { bunker: number; road: number; build: number; radar: number; crash: number; convoy: number };
  /** Мест в казарме бункера без улучшений и прочность бункера. */
  bunker: { roster: number; hp: number };
  /** Броневик: тиков на клетку дороги и бездорожья, с гаражом - быстрее; вброд и сквозь руины - во столько раз медленнее бездорожья. */
  convoy: { roadTicks: number; offroadTicks: number; fastRoadTicks: number; fastOffroadTicks: number; waterFactor: number; ruinFactor: number };
  upgrades: BunkerUpgradeDef[];
  expedition: {
    tech: string; baseCost: number; costPerCell: number; foodPerCell: number;
    ticksPerCell: number; fastTicksPerCell: number; corridor: number; targetRadius: number; farRadius: number;
    maxSoldiers: number; woundChance: number; fastTech: string; discount: number;
  };
  sites: {
    count: Record<SiteKind, number>;
    /** Ближе этого к бункеру находки не лежат (кроме источника воды для старта). */
    minDistance: number;
    cache: { money: [number, number]; metal: [number, number] };
    archive: { percent: number };
    survivors: { money: number };
    metal: { multiplier: number };
    radiation: { radius: number; core: number };
    nest: { ufo: string };
  };
  /** Довоенные кварталы: число и размер, шаг старых улиц, сколько их уцелело (%), шанс руины (%), металл за снос руины, воронки. */
  ruins: { districts: [number, number]; size: [number, number]; roadEvery: number; roadKeep: number; ruinChance: number; metal: number; craters: [number, number] };
  /** Десант: раз в hitTicks тиков пришельцы бьют здание в радиусе, уходят через days дней. */
  landing: { hitTicks: number; radius: number; days: number };
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

export const ECONOMY = economyJson as EconomyDef;

export const WASTELAND = wastelandJson as unknown as WastelandDef;
export const UPGRADE_BY_ID: Record<string, BunkerUpgradeDef> = Object.fromEntries(WASTELAND.upgrades.map((u) => [u.id, u]));

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
