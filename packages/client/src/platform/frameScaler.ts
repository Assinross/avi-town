// Автоподстройка разрешения кадра: плавность держим чёткостью картинки, а не выключением
// эффектов (research.md, R8). Чистый регулятор без DOM: на вход время кадра, на выход масштаб.
//
// Как решается "есть запас". requestAnimationFrame привязан к частоте экрана: на 60 Гц при цели
// 60 FPS кадров больше 60 не будет никогда, и "FPS выше цели на 20%" недостижимо. Поэтому запас -
// одно из двух:
//  1) средний FPS выше цели на 20% - телефон с целью 30 на экране 60 Гц, экраны 120/144 Гц;
//  2) упор в частоту экрана: FPS у самой цели (от 97%), ни одного пропущенного кадра (дольше
//     1,5 бюджета) и, если известно, время работы кадра не больше 80% бюджета.
// Время работы - только JS-часть кадра: WebGL дорисовывает на GPU асинхронно, и упор в GPU оно
// не видит. Поэтому подъём может не удаться - тогда ожидание следующего подъёма удваивается
// (до 40 с), чтобы разрешение не "дребезжало" между двумя ступенями.

/** Ступени масштаба разрешения: доля от базового pixelRatio. */
export const SCALE_STEPS = [1, 0.85, 0.7, 0.6];

/** Окно, по которому считается средний FPS, с. */
const SAMPLE = 0.5;
/** Сколько секунд подряд ниже цели до ступени вниз. */
const DOWN_AFTER = 3;
/** Сколько секунд подряд с запасом до ступени вверх (базовое ожидание). */
const UP_AFTER = 5;
const UP_AFTER_MAX = 40;
/** Запас для подъёма: FPS выше цели на 20% или работа кадра не больше 80% бюджета. */
const HEADROOM = 0.2;
/** "Ниже цели" - с допуском на дрожание vsync: на 60 Гц среднее бывает 59,x (порог 55 FPS). */
const SLOW = 0.92;
/** "У цели" при упоре в частоту экрана. */
const CAPPED = 0.97;
/** Кадр дольше 1,5 бюджета - пропущенный кадр (рывок). */
const JANK = 1.5;
/** После смены ступени - пауза измерений: буферы пересоздаются, первые кадры неровные. */
const SETTLE = 1;
/** Кадр длиннее - вкладка была в фоне или вкладку переключали: это не просадка. */
const PAUSE_DT = 0.5;
/** Подъём, после которого в течение этого времени пришлось опуститься, считается неудачным. */
const FAIL_WINDOW = 10;

export interface FrameScalerConfig {
  targetFps: number;
  /** Нижний порог масштаба; ниже 0,6 добавляется последней ступенью. */
  minScale: number;
}

export class FrameScaler {
  private readonly steps: number[];
  private readonly budget: number;
  private level = 0;
  // Текущее окно замера
  private sampleTime = 0;
  private frames = 0;
  private maxDt = 0;
  private workSum = 0;
  private workFrames = 0;
  // Сколько секунд подряд окна были медленными / с запасом
  private slowTime = 0;
  private goodTime = 0;
  private settle = 0;
  private upAfter = UP_AFTER;
  /** Время с последнего подъёма; Infinity - подъёмов не было. */
  private sinceUp = Infinity;

  constructor(private readonly cfg: FrameScalerConfig) {
    this.steps = SCALE_STEPS.filter((s) => s >= cfg.minScale - 1e-6);
    if (this.steps[this.steps.length - 1] > cfg.minScale) this.steps.push(cfg.minScale);
    this.budget = 1 / cfg.targetFps;
  }

  /** Текущий масштаб разрешения (1 - полное). */
  get scale(): number {
    return this.steps[this.level];
  }

  /**
   * Учесть кадр: dt - время от прошлого кадра, work - время работы кадра (оба в секундах;
   * work можно не передавать). Возвращает true, если масштаб на этом кадре сменился.
   */
  update(dt: number, work?: number): boolean {
    if (!(dt > 0)) return false;
    this.sinceUp += dt;
    if (dt > PAUSE_DT) {
      // Фон или зависание вкладки: замер начинаем заново, просадкой не считаем
      this.resetSample();
      this.slowTime = this.goodTime = 0;
      this.settle = SETTLE;
      return false;
    }
    if (this.settle > 0) {
      this.settle -= dt;
      return false;
    }
    this.sampleTime += dt;
    this.frames++;
    if (dt > this.maxDt) this.maxDt = dt;
    if (work !== undefined && work >= 0) {
      this.workSum += work;
      this.workFrames++;
    }
    if (this.sampleTime < SAMPLE) return false;

    const fps = this.frames / this.sampleTime;
    const target = this.cfg.targetFps;
    const slow = fps < target * SLOW;
    const good = !slow && (fps >= target * (1 + HEADROOM) || (
      fps >= target * CAPPED &&
      this.maxDt <= this.budget * JANK &&
      (this.workFrames === 0 || this.workSum / this.workFrames <= this.budget * (1 - HEADROOM))
    ));
    // Гистерезис: "подряд" - любое окно другого вида обнуляет счётчик
    this.slowTime = slow ? this.slowTime + this.sampleTime : 0;
    this.goodTime = good ? this.goodTime + this.sampleTime : 0;
    this.resetSample();

    if (this.slowTime >= DOWN_AFTER - 1e-6 && this.level < this.steps.length - 1) {
      // Опустились вскоре после подъёма - подъём был неудачным, следующий ждём дольше
      this.upAfter = this.sinceUp < FAIL_WINDOW ? Math.min(this.upAfter * 2, UP_AFTER_MAX) : UP_AFTER;
      return this.change(this.level + 1);
    }
    if (this.goodTime >= this.upAfter - 1e-6 && this.level > 0) {
      this.sinceUp = 0;
      return this.change(this.level - 1);
    }
    return false;
  }

  private change(level: number): boolean {
    this.level = level;
    this.slowTime = this.goodTime = 0;
    this.settle = SETTLE;
    return true;
  }

  private resetSample() {
    this.sampleTime = this.frames = this.maxDt = this.workSum = this.workFrames = 0;
  }
}
