import { signal } from '@preact/signals';

export type Tool = 'inspect' | 'road' | 'house' | 'bulldoze';

export const tool = signal<Tool>('road');
export const money = signal(0);
export const hoverInfo = signal('');
export const message = signal('');

let messageTimer = 0;
export function flash(text: string) {
  message.value = text;
  clearTimeout(messageTimer);
  messageTimer = window.setTimeout(() => (message.value = ''), 1800);
}
