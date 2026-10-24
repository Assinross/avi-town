// Выбор графики и темп кадров проверяются без браузера: чистая логика platform/device.

import { describe, expect, it } from 'vitest';
import { drawHz, QUALITY_BY_ID, savedQuality } from '../src/platform/device';

describe('выбор графики', () => {
  it('без сохранённого выбора - сбалансированная', () => {
    expect(savedQuality(null)).toBe('mid');
  });

  it('неизвестное значение - сбалансированная', () => {
    expect(savedQuality('ultra')).toBe('mid');
  });

  it('сохранённый выбор читается', () => {
    expect(savedQuality('low')).toBe('low');
    expect(savedQuality('high')).toBe('high');
  });

  it('разрешение и тени растут от низкой к красивой', () => {
    expect(QUALITY_BY_ID.low.maxPixelRatio).toBeLessThan(QUALITY_BY_ID.mid.maxPixelRatio);
    expect(QUALITY_BY_ID.mid.maxPixelRatio).toBeLessThan(QUALITY_BY_ID.high.maxPixelRatio);
    expect(QUALITY_BY_ID.low.shadowMapSize).toBeLessThan(QUALITY_BY_ID.mid.shadowMapSize);
    expect(QUALITY_BY_ID.mid.shadowMapSize).toBeLessThan(QUALITY_BY_ID.high.shadowMapSize);
  });
});

describe('темп кадров', () => {
  it('на паузе - 10 кадров в секунду', () => {
    expect(drawHz(0, false)).toBe(10);
  });

  it('в игре - 30 кадров в секунду', () => {
    expect(drawHz(1, false)).toBe(30);
    expect(drawHz(3, false)).toBe(30);
  });

  it('в бою разведка идёт в реальном времени даже на паузе города', () => {
    expect(drawHz(0, true)).toBe(30);
  });
});
