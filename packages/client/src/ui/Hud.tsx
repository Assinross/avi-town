import { PRICES } from '@avi/sim';
import { hoverInfo, message, money, tool, type Tool } from './store';

const TOOLS: { id: Tool; label: string; key: string; price?: number }[] = [
  { id: 'inspect', label: 'Осмотр', key: 'I' },
  { id: 'road', label: 'Дорога', key: 'R', price: PRICES.road },
  { id: 'house', label: 'Дом', key: 'H', price: PRICES.house },
  { id: 'bulldoze', label: 'Снос', key: 'B', price: PRICES.bulldoze },
];

export function Hud({ onRotate }: { onRotate: (step: number) => void }) {
  return (
    <>
      <div class="panel top">
        <span class="brand">Avi Town</span>
        <span class="money">{money.value.toLocaleString('ru-RU')} ¢</span>
        <span class="info">{hoverInfo.value}</span>
      </div>
      {message.value && <div class="toast">{message.value}</div>}
      <div class="panel bottom">
        {TOOLS.map((t) => (
          <button class={tool.value === t.id ? 'active' : ''} onClick={() => (tool.value = t.id)} title={`Клавиша ${t.key}`}>
            {t.label}
            {t.price !== undefined && <small>{t.price} ¢</small>}
          </button>
        ))}
        <span class="sep" />
        <button onClick={() => onRotate(-1)} title="Клавиша Q">⟲</button>
        <button onClick={() => onRotate(1)} title="Клавиша E">⟳</button>
      </div>
      <div class="help">
        ЛКМ - строить (дорогу можно тянуть) · ПКМ/колесо зажато - двигать карту · колесо - приближение · Q/E - поворот · WASD - сдвиг
      </div>
    </>
  );
}
