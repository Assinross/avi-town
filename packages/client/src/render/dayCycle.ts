// Видимые сутки города: смена дня и ночи - только картинка, к игровым дням и экономике
// не привязана. Круг длиннее игрового дня, чтобы вечер, ночь и рассвет успели прожиться.

/** Сколько реальных секунд длятся видимые сутки на скорости x1. */
export const CYCLE_SECONDS = 180;
/** Ускорение суток на x2/x4 мягче, чем у экономики: как у машин и пешеходов. */
const SPEED_POWER = 0.7;
/** Новая игра и загрузка начинаются на рассвете. */
export const CYCLE_START_HOUR = 6;

export type DayPhase = 'dawn' | 'day' | 'evening' | 'night';

export const PHASE_NAME: Record<DayPhase, string> = { dawn: 'рассвет', day: 'день', evening: 'вечер', night: 'ночь' };

/** Границы фаз в часах: рассвет 5-8, день 8-17, вечер 17-21:30, ночь 21:30-5. */
export function phaseAt(hour: number): DayPhase {
  if (hour >= 5 && hour < 8) return 'dawn';
  if (hour >= 8 && hour < 17) return 'day';
  if (hour >= 17 && hour < 21.5) return 'evening';
  return 'night';
}

/**
 * Ночь 0..1 и тёплый свет у горизонта 0..1 по часу суток.
 * Рассвет: темнота уходит с 5 до 7:30, розово-золотой свет около 6:30.
 * Вечер: золотой свет растёт с 17 до 19:30, темнеет с 19 до 21:30.
 */
export function skyAt(hour: number): [number, number] {
  const ramp = (a: number, b: number) => Math.min(1, Math.max(0, (hour - a) / (b - a)));
  const night = hour < 12 ? 1 - ramp(5, 7.5) : ramp(19, 21.5);
  const bump = (peak: number, width: number) => Math.max(0, 1 - Math.abs(hour - peak) / width);
  const warm = Math.max(bump(6.5, 1.6), bump(19.5, 2.5));
  return [night, warm];
}

/** Часы видимых суток: идут, пока город не на паузе, и стоят в бою. */
export class DayCycle {
  /** Час суток 0..24 с долями. */
  hour = CYCLE_START_HOUR;
  /** Номер видимых суток: машины и жители по нему строят новый распорядок. */
  index = 0;
  /** Уже после 6 утра текущих суток: переход через 6:00 начинает новые сутки. */
  private started = true;

  /** factor - множитель скорости игры (0 - пауза). */
  advance(dt: number, factor: number) {
    if (factor <= 0) return;
    this.hour += (dt * 24 * Math.pow(factor, SPEED_POWER)) / CYCLE_SECONDS;
    while (this.hour >= 24) this.hour -= 24;
    // Сутки для распорядка начинаются в 6 утра, как и у машин с пешеходами
    const prev = this.started;
    this.started = this.hour >= CYCLE_START_HOUR;
    if (this.started && !prev) this.index++;
  }

  /** Поставить время вручную (отладка ?hour=22). */
  set(hour: number) {
    this.hour = hour;
    this.started = hour >= CYCLE_START_HOUR;
  }
}
