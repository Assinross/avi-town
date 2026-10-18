import { signal } from '@preact/signals';
import type { Stats } from '@avi/sim';
import type { Overlay } from '../render/sceneView';

export type Tool = 'inspect' | 'road' | 'zoneR' | 'zoneC' | 'zoneI' | 'zoneA' | 'plant' | 'pump' | 'bulldoze';

export interface HudState {
  money: number;
  food: number;
  day: number;
  speed: number;
  hungerDays: number;
  stats: Stats;
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
export const canUndo = signal(false);

let messageTimer = 0;
export function flash(text: string) {
  message.value = text;
  clearTimeout(messageTimer);
  messageTimer = window.setTimeout(() => (message.value = ''), 2200);
}
