// Счётчик кадров для замеров (?fps): средний FPS, 1% худших кадров, время кадра и разрешение.
// Цифры обновляются дважды в секунду, чтобы сама плашка не тратила кадр.

import { signal } from '@preact/signals';
import { render } from 'preact';

interface FrameStats {
  /** Средний FPS за последнюю секунду. */
  fps: number;
  /** Среднее время кадра за последнюю секунду, мс. */
  frameMs: number;
  /** Время работы кадра (JS: симуляция + отрисовка), сглаженное, мс. */
  workMs: number;
  /** Среднее 1% худших кадров за последние 60 с, мс. */
  worstMs: number;
  /** Доля кадров дольше 33 мс за последние 60 с, % (SC-001: не более 1%). */
  longPct: number;
  /** За сколько секунд набраны цифры 60-секундного окна. */
  windowSec: number;
  /** Масштаб разрешения кадра (автоподстройка приходит со своим куском). */
  scale: number;
  pixelRatio: number;
}

const stats = signal<FrameStats | null>(null);

const WINDOW_MS = 60_000;
const LONG_MS = 1000 / 30;
/** Очередь времён кадров за 60 с (с запасом до 240 Гц). */
const ring = new Float32Array(60 * 240);
const scratch = new Float32Array(ring.length);
let head = 0;
let count = 0;
let sum = 0;
let workAvg = 0;
let sincePublish = 0;

/**
 * Учесть кадр (секунды). Кадры дольше 0,5 с - вкладка была в фоне, в замер не идут.
 */
export function recordFrame(dt: number, work: number, scale: number, pixelRatio: number) {
  if (!(dt > 0) || dt > 0.5) return;
  const ms = dt * 1000;
  // Очередь полна - новый кадр затирает самый старый (он как раз под head)
  if (count === ring.length) sum -= ring[head];
  else count++;
  ring[head] = ms;
  head = (head + 1) % ring.length;
  sum += ms;
  // Самые старые кадры за пределами 60 с - вон из очереди
  while (count > 1 && sum > WINDOW_MS) {
    sum -= ring[(head - count + ring.length) % ring.length];
    count--;
  }
  workAvg += (work * 1000 - workAvg) * 0.05;
  sincePublish += dt;
  if (sincePublish >= 0.5) {
    sincePublish = 0;
    stats.value = measure(scale, pixelRatio);
  }
}

function measure(scale: number, pixelRatio: number): FrameStats {
  // Последняя секунда: идём от новых кадров к старым
  let secMs = 0, secFrames = 0;
  for (let i = 1; i <= count && secMs < 1000; i++) {
    secMs += ring[(head - i + ring.length) % ring.length];
    secFrames++;
  }
  // 1% худших и доля долгих за всё окно
  let long = 0;
  for (let i = 0; i < count; i++) {
    const v = ring[(head - count + i + ring.length) % ring.length];
    scratch[i] = v;
    if (v > LONG_MS) long++;
  }
  const sorted = scratch.subarray(0, count).sort();
  const k = Math.max(1, Math.ceil(count * 0.01));
  let worst = 0;
  for (let i = count - k; i < count; i++) worst += sorted[i];
  return {
    fps: secMs > 0 ? (secFrames * 1000) / secMs : 0,
    frameMs: secFrames > 0 ? secMs / secFrames : 0,
    workMs: workAvg,
    worstMs: worst / k,
    longPct: count > 0 ? (long * 100) / count : 0,
    windowSec: sum / 1000,
    scale,
    pixelRatio,
  };
}

function DevStats() {
  const s = stats.value;
  if (!s) return null;
  return (
    <div style={{
      position: 'fixed', right: 4, top: '50%', transform: 'translateY(-50%)', zIndex: 20, pointerEvents: 'none',
      padding: '4px 8px', borderRadius: 6, background: 'rgba(0, 0, 0, 0.6)', color: '#cfe', whiteSpace: 'pre',
      font: '11px/1.4 ui-monospace, monospace', fontVariantNumeric: 'tabular-nums',
    }}>
      {`FPS ${s.fps.toFixed(1)}\n`}
      {`кадр ${s.frameMs.toFixed(1)} мс, работа ${s.workMs.toFixed(1)} мс\n`}
      {`1% худших ${s.worstMs.toFixed(1)} мс\n`}
      {`дольше 33 мс ${s.longPct.toFixed(2)}% (за ${s.windowSec.toFixed(0)} с)\n`}
      {`разрешение ${Math.round(s.scale * 100)}%, pixelRatio ${s.pixelRatio.toFixed(2)}`}
    </div>
  );
}

/** Показать плашку поверх игры (вызывается из main.tsx по ?fps). */
export function mountDevStats() {
  const el = document.createElement('div');
  document.body.appendChild(el);
  render(<DevStats />, el);
}
