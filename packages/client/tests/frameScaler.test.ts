import { describe, expect, it } from 'vitest';
import { FrameScaler } from '../src/platform/frameScaler';

// FPS в тестах - 16, 32, 64: у них dt точный в двоичной записи, и окна по 0,5 с не "плывут"

/** Прогнать кадры с постоянным FPS заданное время; вернуть число смен масштаба. */
function feed(s: FrameScaler, fps: number, seconds: number, work?: number): number {
  let changes = 0;
  const n = Math.round(seconds * fps);
  for (let i = 0; i < n; i++) if (s.update(1 / fps, work)) changes++;
  return changes;
}

const pc = () => new FrameScaler({ targetFps: 60, minScale: 0.6 });
const phone = () => new FrameScaler({ targetFps: 30, minScale: 0.6 });

describe('автоподстройка разрешения', () => {
  it('держится на полном разрешении, пока кадры в цели', () => {
    const s = pc();
    expect(feed(s, 64, 30)).toBe(0);
    expect(s.scale).toBe(1);
  });

  it('после 3 секунд ниже цели - ступень вниз, не раньше', () => {
    const s = pc();
    feed(s, 32, 2.5);
    expect(s.scale).toBe(1);
    feed(s, 32, 0.5);
    expect(s.scale).toBe(0.85);
  });

  it('после смены ступени - пауза 1 с, следующая ступень не раньше чем через 1 + 3 с', () => {
    const s = pc();
    feed(s, 32, 3);
    expect(s.scale).toBe(0.85);
    feed(s, 32, 3.5);
    expect(s.scale).toBe(0.85);
    feed(s, 32, 0.5);
    expect(s.scale).toBe(0.7);
  });

  it('ниже нижнего порога не опускается', () => {
    const s = pc();
    feed(s, 16, 120);
    expect(s.scale).toBe(0.6);
    const low = new FrameScaler({ targetFps: 30, minScale: 0.5 });
    feed(low, 8, 120);
    expect(low.scale).toBe(0.5);
  });

  it('при запасе 20% 5 секунд подряд - ступень вверх (телефон, цель 30, экран 60 Гц)', () => {
    const s = phone();
    feed(s, 16, 3);
    expect(s.scale).toBe(0.85);
    feed(s, 64, 5.5); // пауза 1 с + 4,5 с запаса - мало
    expect(s.scale).toBe(0.85);
    feed(s, 64, 0.5);
    expect(s.scale).toBe(1);
  });

  it('на верхней ступени подниматься некуда', () => {
    const s = phone();
    expect(feed(s, 64, 60)).toBe(0);
    expect(s.scale).toBe(1);
  });

  it('цель 60 на экране 60 Гц: запас - ровные кадры и лёгкая работа кадра', () => {
    const heavy = pc();
    feed(heavy, 32, 3);
    expect(heavy.scale).toBe(0.85);
    // Ровные кадры, но работа 15 мс из 16,7 - запаса нет
    feed(heavy, 64, 20, 0.015);
    expect(heavy.scale).toBe(0.85);
    // Работа 5 мс - запас есть
    feed(heavy, 64, 6, 0.005);
    expect(heavy.scale).toBe(1);

    // Без времени работы - по ровным кадрам без пропусков
    const plain = pc();
    feed(plain, 32, 3);
    feed(plain, 64, 6);
    expect(plain.scale).toBe(1);
  });

  it('пропущенные кадры (рывки) не дают подняться', () => {
    const s = pc();
    feed(s, 32, 3);
    for (let i = 0; i < 20; i++) {
      feed(s, 64, 0.45);
      s.update(0.04); // один кадр 40 мс в каждом окне
    }
    expect(s.scale).toBe(0.85);
  });

  it('гистерезис: между "медленно" и "с запасом" ступень не меняется', () => {
    const s = pc();
    // ~57 FPS: не ниже порога 55, но и не ровные 60
    expect(feed(s, 512 / 9, 60)).toBe(0);
    expect(s.scale).toBe(1);
    // Чередование 2 с медленно / 2 с быстро - ни одна серия не набирает нужной длины
    feed(s, 32, 3);
    expect(s.scale).toBe(0.85);
    let changes = 0;
    for (let i = 0; i < 20; i++) changes += feed(s, 32, 2) + feed(s, 64, 2);
    expect(changes).toBe(0);
    expect(s.scale).toBe(0.85);
  });

  it('неудачный подъём - следующий ждёт вдвое дольше', () => {
    const s = phone();
    feed(s, 16, 3);
    feed(s, 64, 6);
    expect(s.scale).toBe(1);
    feed(s, 16, 4); // на полном разрешении снова не успевает
    expect(s.scale).toBe(0.85);
    feed(s, 64, 7); // 1 + 5 с теперь мало
    expect(s.scale).toBe(0.85);
    feed(s, 64, 5); // ждёт 10 с
    expect(s.scale).toBe(1);
  });

  it('вкладка в фоне (кадр дольше 0,5 с) - не просадка', () => {
    const s = pc();
    feed(s, 32, 2.5);
    s.update(5); // вернулись на вкладку
    feed(s, 32, 1.5);
    expect(s.scale).toBe(1);
    // Одни только длинные кадры - тоже не просадка
    for (let i = 0; i < 100; i++) s.update(0.8);
    expect(s.scale).toBe(1);
    // Нулевые и отрицательные dt игнорируются
    expect(s.update(0)).toBe(false);
    expect(s.update(-0.01)).toBe(false);
  });
});
