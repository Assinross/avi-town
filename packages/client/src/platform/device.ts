// Определение возможностей устройства: тач-режим (реактивно) и профиль качества
// рендера (один раз при старте). Все решения - research.md (R3, R4).

import { signal } from '@preact/signals';

/** Реактивный тач-режим: палец как основное наведение. Переключается без перезагрузки. */
export const touchMode = signal(
  typeof window !== 'undefined' &&
    (window.matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 0),
);

if (typeof window !== 'undefined') {
  const mq = window.matchMedia('(pointer: coarse)');
  const update = () => (touchMode.value = mq.matches || navigator.maxTouchPoints > 0);
  mq.addEventListener('change', update);
}

export interface QualityProfile {
  shadowMapSize: number;
  maxPixelRatio: number;
  /** Сколько машин одновременно на улицах. */
  maxCars: number;
  /** Сколько пешеходов одновременно на улицах. */
  maxPeople: number;
  /** Ночное свечение кадра (bloom): на телефоне выключено. */
  nightBloom: boolean;
  /** Сколько настоящих точечных огней ночью: на телефоне ни одного. */
  nightLights: number;
  /** Множитель яркости ночных огней: на телефоне слабее, чтобы не греть экран. */
  nightGlow: number;
}

export const DESKTOP_QUALITY: QualityProfile = { shadowMapSize: 4096, maxPixelRatio: 2, maxCars: 220, maxPeople: 24, nightBloom: true, nightLights: 8, nightGlow: 1 };
export const MOBILE_QUALITY: QualityProfile = { shadowMapSize: 1024, maxPixelRatio: 1.5, maxCars: 90, maxPeople: 8, nightBloom: false, nightLights: 0, nightGlow: 0.8 };

/** Профиль качества выбирается один раз при старте: мобильный UA - мобильные тени и плотность. */
export function qualityProfile(): QualityProfile {
  const mobile = /\b(Android|iPhone|iPad|iPod)\b/i.test(navigator.userAgent);
  return mobile ? MOBILE_QUALITY : DESKTOP_QUALITY;
}
