// Определение возможностей устройства: тач-режим (реактивно) и профиль качества
// рендера (один раз при старте). Все решения - research.md (R3, R4).
// Профиль графики игрок выбирает в настройках (⚙): выбор хранится в localStorage,
// на слабых ноутбуках ближе "Сбалансированная" - она греет меньше.

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
  /** Цель плавности: ниже неё автоподстройка снижает разрешение кадра (frameScaler.ts). */
  targetFps: number;
  /**
   * Нижний порог масштаба разрешения. 0,6 обоим: у телефона и так pixelRatio не выше 1,5,
   * 0,6 от него - 0,9 пикселя экрана на пиксель кадра; ниже контур и надписи на домах "мылятся".
   */
  minScale: number;
}

const BASE_MOBILE: QualityProfile = { shadowMapSize: 1024, maxPixelRatio: 1.5, maxCars: 90, maxPeople: 8, nightBloom: false, nightLights: 0, nightGlow: 0.8, targetFps: 30, minScale: 0.6 };

/** "Производительность" для слабых ноутбуков: рендер в исходном разрешении, без свечения и огней. */
export const LOW_QUALITY: QualityProfile = { shadowMapSize: 1024, maxPixelRatio: 1, maxCars: 60, maxPeople: 8, nightBloom: false, nightLights: 0, nightGlow: 0.8, targetFps: 30, minScale: 0.6 };
/** "Сбалансированная": разрешение чуть выше экрана, тени 2048, город менее плотный. */
export const MID_QUALITY: QualityProfile = { shadowMapSize: 2048, maxPixelRatio: 1.25, maxCars: 120, maxPeople: 12, nightBloom: true, nightLights: 6, nightGlow: 1, targetFps: 60, minScale: 0.6 };
/** "Красивая": прежний настольный максимум. */
export const HIGH_QUALITY: QualityProfile = { shadowMapSize: 4096, maxPixelRatio: 2, maxCars: 220, maxPeople: 24, nightBloom: true, nightLights: 8, nightGlow: 1, targetFps: 60, minScale: 0.6 };
export const MOBILE_QUALITY: QualityProfile = BASE_MOBILE;

export type QualityId = 'low' | 'mid' | 'high';
export const QUALITY_BY_ID: Record<QualityId, QualityProfile> = {
  low: LOW_QUALITY,
  mid: MID_QUALITY,
  high: HIGH_QUALITY,
};

const QUALITY_KEY = 'avi-town.quality';

/** Сохранённый выбор графики; отсутствует или неизвестен - сбалансированная. */
export function savedQuality(value: string | null): QualityId {
  return value === 'low' || value === 'mid' || value === 'high' ? value : 'mid';
}

export function currentQualityId(): QualityId {
  if (typeof window === 'undefined') return 'mid';
  let saved: string | null = null;
  try {
    saved = localStorage.getItem(QUALITY_KEY);
  } catch { /* хранилище недоступно - дефолт */ }
  return savedQuality(saved);
}

export function saveQuality(id: QualityId) {
  try {
    localStorage.setItem(QUALITY_KEY, id);
  } catch { /* хранилище недоступно - живём с выбором до перезагрузки */ }
}

/** Профиль качества выбирается один раз при старте: мобильный UA - мобильные тени и плотность. */
export function qualityProfile(): QualityProfile {
  const mobile = /\b(Android|iPhone|iPad|iPod)\b/i.test(navigator.userAgent);
  return mobile ? MOBILE_QUALITY : QUALITY_BY_ID[currentQualityId()];
}

// Темп кадров: игра рисует не чаще, чем позволяет охлаждение ноутбука.
// На паузе экран почти статичен - десяти кадров хватает побиться глазу.
/** Кадров в секунду, пока время идёт. */
export const PLAY_HZ = 30;
/** Кадров в секунду на паузе города. */
export const PAUSE_HZ = 10;

/** Темп кадров: в игре 30, на паузе 10; в бою разведка идёт в реальном времени - не тормозим игру. */
export function drawHz(speed: number, inMission: boolean): number {
  return speed === 0 && !inMission ? PAUSE_HZ : PLAY_HZ;
}

// Эффекты, которые можно выключить для сравнения вида и стоимости: ?fx=-outline,-bloom (минус - выключить).
export const FX_NAMES = ['outline', 'bloom', 'shadows'] as const;
export type FxName = (typeof FX_NAMES)[number];
export type FxFlags = Record<FxName, boolean>;

/** Разбор ?fx: по умолчанию всё включено; "-имя" выключает, "имя" или "+имя" - включает. */
export function parseFx(arg: string | null): FxFlags {
  const fx = Object.fromEntries(FX_NAMES.map((n) => [n, true])) as FxFlags;
  for (const raw of (arg ?? '').split(',')) {
    const item = raw.trim();
    if (!item) continue;
    const name = item.replace(/^[-+]/, '') as FxName;
    if (FX_NAMES.includes(name)) fx[name] = !item.startsWith('-');
    else console.warn(`?fx: неизвестный эффект "${name}", есть: ${FX_NAMES.join(', ')}`);
  }
  return fx;
}

/** Флаги эффектов этой страницы: рендер читает их отсюда (в dev - ещё и window.avi.fx). */
export const fxFlags: FxFlags = parseFx(typeof location !== 'undefined' ? new URLSearchParams(location.search).get('fx') : null);
