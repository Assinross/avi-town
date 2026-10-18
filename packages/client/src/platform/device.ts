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
}

export const DESKTOP_QUALITY: QualityProfile = { shadowMapSize: 4096, maxPixelRatio: 2 };
export const MOBILE_QUALITY: QualityProfile = { shadowMapSize: 1024, maxPixelRatio: 1.5 };

/** Профиль качества выбирается один раз при старте: мобильный UA - мобильные тени и плотность. */
export function qualityProfile(): QualityProfile {
  const mobile = /\b(Android|iPhone|iPad|iPod)\b/i.test(navigator.userAgent);
  return mobile ? MOBILE_QUALITY : DESKTOP_QUALITY;
}
