import { signal } from '@preact/signals';
import type { CrashSite, ResearchState, Resources, Stats } from '@avi/sim';
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
}

export interface TileCard {
  title: string;
  lines: string[];
}

export const tool = signal<Tool>('road');
export const overlay = signal<Overlay>('none');
export const hud = signal<HudState | null>(null);
export const hoverInfo = signal('');
export const card = signal<TileCard | null>(null);
export const message = signal('');
export const alert = signal('');
export const canUndo = signal(false);
export const researchOpen = signal(false);

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
