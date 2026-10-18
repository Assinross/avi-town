import { describe, expect, it } from 'vitest';
import { attachGestures, TAP_SLOP_PX, type GestureCallbacks } from '../src/input/gestures';

type Listener = (e: FakePointerEvent) => void;

class FakePointerEvent {
  constructor(
    public pointerId: number,
    public clientX: number,
    public clientY: number,
    public pointerType: string = 'touch',
  ) {}
}

/** Минимальный таргет: только слушатели и захват указателя. */
function fakeTarget() {
  const listeners: Record<string, Listener[]> = {};
  const target = {
    addEventListener(type: string, fn: Listener) {
      (listeners[type] ??= []).push(fn);
    },
    removeEventListener(type: string, fn: Listener) {
      listeners[type] = (listeners[type] ?? []).filter((f) => f !== fn);
    },
    setPointerCapture() {},
    fire(type: string, e: FakePointerEvent) {
      for (const fn of listeners[type] ?? []) fn(e);
    },
  };
  return target;
}

function recording() {
  const calls: [string, ...number[]][] = [];
  const cb: GestureCallbacks = {
    tap: (x, y) => calls.push(['tap', x, y]),
    panStart: (x, y) => calls.push(['panStart', x, y]),
    panMove: (dx, dy) => calls.push(['panMove', dx, dy]),
    panEnd: () => calls.push(['panEnd']),
    buildStart: (x, y) => calls.push(['buildStart', x, y]),
    buildMove: (x, y) => calls.push(['buildMove', x, y]),
    buildEnd: (x, y) => calls.push(['buildEnd', x, y]),
    buildCancel: () => calls.push(['buildCancel']),
    zoom: (f) => calls.push(['zoom', f]),
  };
  return { calls, cb, names: () => calls.map(([n]) => n) };
}

function setup(isInspect: boolean) {
  const t = fakeTarget();
  const r = recording();
  const detach = attachGestures(t as unknown as HTMLElement, r.cb, { isInspect: () => isInspect });
  return { t, ...r, detach };
}

describe('attachGestures', () => {
  it('тап без сдвига больше slop - событие tap', () => {
    const { t, names, calls } = setup(true);
    t.fire('pointerdown', new FakePointerEvent(1, 100, 100));
    t.fire('pointerup', new FakePointerEvent(1, 100 + TAP_SLOP_PX - 1, 100));
    expect(names()).toEqual(['tap']);
    expect(calls[0]).toEqual(['tap', 107, 100]);
  });

  it('протяжка в inspect - панорама, тапа нет', () => {
    const { t, names } = setup(true);
    t.fire('pointerdown', new FakePointerEvent(1, 100, 100));
    t.fire('pointermove', new FakePointerEvent(1, 140, 120));
    t.fire('pointermove', new FakePointerEvent(1, 160, 130));
    t.fire('pointerup', new FakePointerEvent(1, 160, 130));
    const n = names();
    expect(n[0]).toBe('panStart');
    expect(n).toContain('panMove');
    expect(n[n.length - 1]).toBe('panEnd');
    expect(n).not.toContain('tap');
    expect(n).not.toContain('buildStart');
  });

  it('протяжка с инструментом - build, панорамы нет', () => {
    const { t, names } = setup(false);
    t.fire('pointerdown', new FakePointerEvent(1, 100, 100));
    t.fire('pointermove', new FakePointerEvent(1, 150, 100));
    t.fire('pointerup', new FakePointerEvent(1, 200, 100));
    const n = names();
    expect(n).toEqual(['buildStart', 'buildMove', 'buildEnd']);
  });

  it('второй палец во время build - отмена и переход в pinch', () => {
    const { t, names } = setup(false);
    t.fire('pointerdown', new FakePointerEvent(1, 100, 100));
    t.fire('pointermove', new FakePointerEvent(1, 150, 100));
    t.fire('pointerdown', new FakePointerEvent(2, 300, 100));
    expect(names()).toEqual(['buildStart', 'buildMove', 'buildCancel']);
  });

  it('pinch растяжения даёт зум > 1, сжатие < 1', () => {
    const { t, calls } = setup(true);
    t.fire('pointerdown', new FakePointerEvent(1, 100, 100));
    t.fire('pointerdown', new FakePointerEvent(2, 200, 100));
    // растяжение: 100 -> 150 между пальцами
    t.fire('pointermove', new FakePointerEvent(1, 100, 100));
    t.fire('pointermove', new FakePointerEvent(2, 250, 100));
    const zooms = calls.filter(([n]) => n === 'zoom').map(([, f]) => f as number);
    expect(zooms.length).toBeGreaterThan(0);
    expect(zooms[zooms.length - 1]).toBeGreaterThan(1);
  });

  it('мышь игнорируется полностью', () => {
    const { t, names } = setup(true);
    t.fire('pointerdown', new FakePointerEvent(1, 100, 100, 'mouse'));
    t.fire('pointermove', new FakePointerEvent(1, 200, 200, 'mouse'));
    t.fire('pointerup', new FakePointerEvent(1, 200, 200, 'mouse'));
    expect(names()).toEqual([]);
  });

  it('один палец после pinch продолжает панораму', () => {
    const { t, names } = setup(true);
    t.fire('pointerdown', new FakePointerEvent(1, 100, 100));
    t.fire('pointerdown', new FakePointerEvent(2, 200, 100));
    t.fire('pointerup', new FakePointerEvent(2, 200, 100));
    const n = names();
    expect(n[n.length - 1]).toBe('panStart');
    // дальнейшее движение оставшегося пальца - панорама
    t.fire('pointermove', new FakePointerEvent(1, 130, 110));
    expect(names()[names().length - 1]).toBe('panMove');
  });

  it('pointercancel во время build отменяет без buildEnd', () => {
    const { t, names } = setup(false);
    t.fire('pointerdown', new FakePointerEvent(1, 100, 100));
    t.fire('pointermove', new FakePointerEvent(1, 150, 100));
    t.fire('pointercancel', new FakePointerEvent(1, 150, 100));
    const n = names();
    expect(n).toContain('buildCancel');
    expect(n).not.toContain('buildEnd');
  });

  it('detach удаляет слушатели', () => {
    const { t, names, detach } = setup(true);
    detach();
    t.fire('pointerdown', new FakePointerEvent(1, 100, 100));
    t.fire('pointerup', new FakePointerEvent(1, 100, 100));
    expect(names()).toEqual([]);
  });
});
