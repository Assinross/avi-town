import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flash, notes, raiseAlert } from '../src/ui/store';

// В node нет window - подставляем двойников для setTimeout/clearTimeout
(globalThis as Record<string, unknown>).window ??= globalThis;

beforeEach(() => {
  vi.useFakeTimers();
  notes.value = [];
});

afterEach(() => {
  vi.useRealTimers();
});

describe('очередь уведомлений', () => {
  it('два сообщения подряд видны одновременно, а не затирают друг друга', () => {
    flash('Зонировано: 1 кл. за 5 ¢');
    flash('Игра сохранена');
    expect(notes.value.map((n) => n.text)).toEqual(['Зонировано: 1 кл. за 5 ¢', 'Игра сохранена']);
  });

  it('flash исчезает через 2.6 с, alert живёт до 6 с', () => {
    flash('обычное');
    raiseAlert('тревога');
    vi.advanceTimersByTime(2601);
    expect(notes.value.map((n) => n.text)).toEqual(['тревога']);
    vi.advanceTimersByTime(3400);
    expect(notes.value).toEqual([]);
  });

  it('очередь ограничена - самое старое уходит, если навалилось больше пяти', () => {
    for (let i = 1; i <= 7; i++) flash(`сообщение ${i}`);
    const texts = notes.value.map((n) => n.text);
    expect(texts).toHaveLength(5);
    expect(texts[texts.length - 1]).toBe('сообщение 7');
  });
});
