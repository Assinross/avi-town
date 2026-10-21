import { signal } from '@preact/signals';
import type { Budget, CrashSite, ResearchState, Resources, Stats } from '@avi/sim';
import type { Overlay } from '../render/sceneView';

/** `b:<id>` - поставить здание из @avi/data. */
export type Tool = 'inspect' | 'road' | 'zoneR' | 'zoneC' | 'zoneI' | 'zoneA' | 'bulldoze' | `b:${string}`;

export interface RaidInfo {
  ufo: string;
  hp: number;
  maxHp: number;
  phase: 'approach' | 'attack' | 'leave';
  detected: boolean;
}

export interface HudState {
  money: number;
  food: number;
  day: number;
  speed: number;
  hungerDays: number;
  stats: Stats;
  resources: Resources;
  research: ResearchState;
  raid: RaidInfo | null;
  crash: CrashSite | null;
  nextRaidDay: number;
  summary: CitySummary;
  squad: SquadMember[];
  budget: Budget;
  over: 'bankrupt' | null;
}

/** Боец в составе отряда для панели "Отряд". */
export interface SquadMember {
  id: number;
  name: string;
  hp: number;
  maxHp: number;
  /** Дней до выздоровления при нынешней скорости лечения; 0 - готов к бою. */
  days: number;
  /** Тяжело ранен (здоровье 0). */
  down: boolean;
  personal: boolean;
}

export interface CitySummary {
  /** По типу зоны: участки без дома, дома 1..3 уровня, в стройке. */
  zones: Record<'R' | 'C' | 'I' | 'A', [number, number, number, number, number]>;
  buildings: number;
  buildingSites: number;
  roads: number;
}

export interface TileCard {
  title: string;
  lines: string[];
  x: number;
  y: number;
  /** Прогресс стройки 0..100, если клетка строится. */
  progress?: number;
  /** Подпись кнопки сноса, если тут есть что сносить. */
  demolish?: string;
}

export const tool = signal<Tool>('inspect');
/** Открытый выдвижной список категории в нижней панели. */
export const drawer = signal<string | null>(null);
export const statsOpen = signal(false);
export const overlay = signal<Overlay>('none');
export const hud = signal<HudState | null>(null);
/** Время суток для часов в шапке: "07:30" с шагом 10 минут. */
export const clock = signal('06:00');
export const hoverInfo = signal('');
export const card = signal<TileCard | null>(null);
export const message = signal('');
export const alert = signal('');
export const canUndo = signal(false);
export const researchOpen = signal(false);
export const squadOpen = signal(false);
export const budgetOpen = signal(false);

export interface CombatUnit {
  id: number;
  name: string;
  side: 'xcom' | 'alien';
  hp: number;
  maxHp: number;
  ap: number;
  personal: boolean;
  /** Патроны в магазине. */
  ammo: number;
  /** Ёмкость магазина; 0 - бесконечное оружие. */
  mag: number;
  /** Укрытие против ближайшего видимого врага: 80 - с приседом, 0 - фланг. */
  cover: 0 | 20 | 40 | 80;
  /** Рядом есть укрытие - присед пройдёт проверку симуляции. */
  adjacentCover: boolean;
  /** Стоит на наблюдении. */
  overwatch: boolean;
  /** Присел в укрытии. */
  hunkered: boolean;
}

export interface CombatState {
  ufo: string;
  phase: 'explore' | 'turn' | 'result';
  turn: number;
  result: 'win' | 'lose' | 'retreat' | null;
  units: CombatUnit[];
  log: string[];
  aliensSeen: number;
}

export const combat = signal<CombatState | null>(null);
export const selectedUnit = signal(0);

let messageTimer = 0;
export function flash(text: string) {
  message.value = text;
  clearTimeout(messageTimer);
  messageTimer = window.setTimeout(() => (message.value = ''), 2600);
}

let alertTimer = 0;
/** Важное событие (налёт, крушение) - красная плашка подольше. */
export function raiseAlert(text: string) {
  alert.value = text;
  clearTimeout(alertTimer);
  alertTimer = window.setTimeout(() => (alert.value = ''), 6000);
}
