// Сенсорные жесты поверх Pointer Events: тап, протяжка одним пальцем (панорама
// или действие инструмента), панорама и зум двумя пальцами. Мышиные события
// игнорируются - десктопный ввод остаётся в main.tsx без изменений.
// Контракт и пороги - contracts/touch-input.md и data-model.md.

export interface GestureCallbacks {
  /** Тап по экрану (не по UI - только canvas). */
  tap(x: number, y: number): void;
  /** Начало панорамы. */
  panStart(x: number, y: number): void;
  /** Продолжение панорамы: смещение от предыдущего кадра в CSS-пикселях. */
  panMove(dx: number, dy: number): void;
  /** Конец панорамы. */
  panEnd(): void;
  /** Начало протяжки строительного инструмента (один палец + строительный инструмент). */
  buildStart(x: number, y: number): void;
  /** Движение строительного инструмента (координаты - как у тапа). */
  buildMove(x: number, y: number): void;
  /** Конец действия строителя. */
  buildEnd(x: number, y: number): void;
  /** Отмена начатого build вторым пальцем. */
  buildCancel(): void;
  /** Изменение масштаба: множитель относительно предыдущего кадра; x, y - середина между пальцами. */
  zoom(factor: number, x: number, y: number): void;
  /** Поворот двумя пальцами: угол в радианах относительно предыдущего кадра. */
  turn?(rad: number): void;
}

export interface GestureOptions {
  /** 'inspect' - панорама одним пальцем; иначе один палец строит, камера - двумя. */
  isInspect(): boolean;
}

/** Мёртвая зона: меньше - тап, больше - протяжка (дрожание пальца). */
export const TAP_SLOP_PX = 8;

type Mode = 'idle' | 'pending' | 'pan1' | 'build' | 'pinch';

interface Pt {
  x: number;
  y: number;
}

export function attachGestures(target: HTMLElement, cb: GestureCallbacks, opts: GestureOptions): () => void {
  const pointers = new Map<number, Pt>();
  let mode: Mode = 'idle';
  let origin: Pt | null = null;
  /** База pinch: прошлые центр и расстояние - для дельт зума и панорамы. */
  let prevPinch: { cx: number; cy: number; dist: number; angle: number } | null = null;

  const pts = () => [...pointers.values()];
  const centroid = () => {
    const a = pts();
    return { x: (a[0].x + a[1].x) / 2, y: (a[0].y + a[1].y) / 2 };
  };
  const dist = () => {
    const a = pts();
    return Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y);
  };
  const angle = () => {
    const a = pts();
    return Math.atan2(a[1].y - a[0].y, a[1].x - a[0].x);
  };
  const pinchBase = () => ({ cx: centroid().x, cy: centroid().y, dist: dist(), angle: angle() });

  function down(e: PointerEvent) {
    if (e.pointerType === 'mouse') return;
    target.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 1) {
      origin = { x: e.clientX, y: e.clientY };
      mode = 'pending';
    } else if (pointers.size >= 2) {
      // Второй палец - камера: отменяем незавершённое строительство
      if (mode === 'build') cb.buildCancel();
      mode = 'pinch';
      prevPinch = pinchBase();
    }
  }

  function move(e: PointerEvent) {
    if (e.pointerType === 'mouse') return;
    const prev = pointers.get(e.pointerId);
    if (!prev) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (mode === 'pending' && origin) {
      if (Math.hypot(e.clientX - origin.x, e.clientY - origin.y) > TAP_SLOP_PX) {
        if (opts.isInspect()) {
          mode = 'pan1';
          cb.panStart(origin.x, origin.y);
        } else {
          mode = 'build';
          cb.buildStart(origin.x, origin.y);
        }
      } else return;
    }
    if (mode === 'pan1') {
      cb.panMove(e.clientX - prev.x, e.clientY - prev.y);
    } else if (mode === 'build') {
      cb.buildMove(e.clientX, e.clientY);
    } else if (mode === 'pinch' && pointers.size >= 2 && prevPinch) {
      const next = pinchBase();
      cb.panMove(next.cx - prevPinch.cx, next.cy - prevPinch.cy);
      if (prevPinch.dist > 0) cb.zoom(next.dist / prevPinch.dist, next.cx, next.cy);
      // Угол через полный оборот (-PI -> PI) - не скачок, а малый поворот
      let da = next.angle - prevPinch.angle;
      if (da > Math.PI) da -= 2 * Math.PI;
      else if (da < -Math.PI) da += 2 * Math.PI;
      cb.turn?.(da);
      prevPinch = next;
    }
  }

  function up(e: PointerEvent) {
    if (e.pointerType === 'mouse') return;
    if (!pointers.has(e.pointerId)) return;
    pointers.delete(e.pointerId);
    if (mode === 'pending') cb.tap(e.clientX, e.clientY);
    else if (mode === 'pan1') cb.panEnd();
    else if (mode === 'build') cb.buildEnd(e.clientX, e.clientY);
    if (pointers.size >= 2) {
      // Осталось два из трёх - пересчитываем базу pinch
      mode = 'pinch';
      prevPinch = pinchBase();
    } else if (pointers.size === 1) {
      if (mode === 'pinch') {
        // Один палец после щипка - продолжаем панораму с его позиции
        const p = pts()[0];
        mode = 'pan1';
        cb.panStart(p.x, p.y);
      }
    } else {
      mode = 'idle';
      origin = null;
      prevPinch = null;
    }
  }

  function cancel(e: PointerEvent) {
    if (e.pointerType === 'mouse') return;
    if (!pointers.has(e.pointerId)) return;
    pointers.delete(e.pointerId);
    if (mode === 'build') cb.buildCancel();
    else if (mode === 'pan1') cb.panEnd();
    mode = pointers.size >= 2 ? 'pinch' : pointers.size === 1 ? 'pan1' : 'idle';
    if (mode === 'pinch') prevPinch = pinchBase();
    if (mode === 'pan1') {
      const p = pts()[0];
      cb.panStart(p.x, p.y);
    }
    if (mode === 'idle') {
      origin = null;
      prevPinch = null;
    }
  }

  target.addEventListener('pointerdown', down);
  target.addEventListener('pointermove', move);
  target.addEventListener('pointerup', up);
  target.addEventListener('pointercancel', cancel);
  return () => {
    target.removeEventListener('pointerdown', down);
    target.removeEventListener('pointermove', move);
    target.removeEventListener('pointerup', up);
    target.removeEventListener('pointercancel', cancel);
  };
}
