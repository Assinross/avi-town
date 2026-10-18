import { DAYS_PER_MONTH, PRICES } from '@avi/sim';
import { canUndo, card, hoverInfo, hud, message, overlay, tool, type Tool } from './store';

export interface HudActions {
  rotate: (step: number) => void;
  setSpeed: (speed: number) => void;
  undo: () => void;
  save: () => void;
  newGame: () => void;
}

interface ToolDef { id: Tool; label: string; price?: string; hint: string }
interface Group { id: string; label: string; tools: ToolDef[] }

const GROUPS: Group[] = [
  { id: 'inspect', label: 'Осмотр', tools: [{ id: 'inspect', label: 'Осмотр', hint: 'Щелчок по клетке - карточка' }] },
  { id: 'road', label: 'Дороги', tools: [{ id: 'road', label: 'Дорога', price: `${PRICES.road} ¢`, hint: 'Тяни по земле. Дороги несут ток и воду' }] },
  {
    id: 'zones', label: 'Зоны', tools: [
      { id: 'zoneR', label: 'Жильё', price: `${PRICES.zone} ¢/кл`, hint: 'Тяни прямоугольник. Растёт до 2 клеток от дороги' },
      { id: 'zoneC', label: 'Торговля', price: `${PRICES.zone} ¢/кл`, hint: 'Рабочие места и налоги, нужны жители' },
      { id: 'zoneI', label: 'Промзона', price: `${PRICES.zone} ¢/кл`, hint: 'Много рабочих мест, загрязняет жильё рядом' },
      { id: 'zoneA', label: 'Фермы', price: `${PRICES.zone} ¢/кл`, hint: 'Еда. Лучше всего на плодородной земле' },
    ],
  },
  {
    id: 'utility', label: 'Ток и вода', tools: [
      { id: 'plant', label: 'Генератор', price: `${PRICES.plant} ¢`, hint: '2x2, нужна дорога рядом. 600 ед. тока' },
      { id: 'pump', label: 'Насосная', price: `${PRICES.pump} ¢`, hint: 'У воды - 400 ед., вдали - колодец на 120' },
    ],
  },
  { id: 'bulldoze', label: 'Снос', tools: [{ id: 'bulldoze', label: 'Снос', hint: 'Тяни рамку - снесёт всё внутри' }] },
];

const groupOf = (t: Tool) => GROUPS.find((g) => g.tools.some((x) => x.id === t))!;

function fmt(n: number) {
  return n.toLocaleString('ru-RU');
}

function signed(n: number) {
  return (n >= 0 ? '+' : '') + fmt(n);
}

function Demand() {
  const h = hud.value;
  if (!h) return null;
  const items: [string, number, string][] = [['Ж', h.stats.demand.R, '#7ec850'], ['Т', h.stats.demand.C, '#4fc3ff'], ['П', h.stats.demand.I, '#ffd66b'], ['Ф', h.stats.demand.A, '#c9a46a']];
  return (
    <div class="demand" title="Спрос: жильё, торговля, промзона, фермы">
      {items.map(([k, v, c]) => (
        <div class="dcol">
          <div class="dbar"><div class={v >= 0 ? 'up' : 'down'} style={{ height: `${Math.abs(v) / 2}%`, background: c }} /></div>
          <span>{k}</span>
        </div>
      ))}
    </div>
  );
}

function TopBar({ actions }: { actions: HudActions }) {
  const h = hud.value;
  if (!h) return null;
  const s = h.stats;
  const net = (s.incomeDay - s.upkeepDay) * DAYS_PER_MONTH;
  const month = Math.floor((h.day - 1) / DAYS_PER_MONTH) + 1;
  const dayOfMonth = ((h.day - 1) % DAYS_PER_MONTH) + 1;
  const foodNet = s.foodProd - s.foodUse;
  return (
    <div class="panel top">
      <span class="brand">Avi Town</span>
      <span class="res money" title="Казна и прирост за месяц">¢ {fmt(h.money)} <em class={net >= 0 ? 'pos' : 'neg'}>{signed(net)}</em></span>
      <span class="res" title="Жители / рабочие места">👥 {fmt(s.population)} <em>{fmt(s.jobs)} раб.</em></span>
      <span class={`res ${h.hungerDays > 0 ? 'alert' : ''}`} title="Еда: запас и баланс в день">🌾 {fmt(h.food)} <em class={foodNet >= 0 ? 'pos' : 'neg'}>{signed(foodNet)}</em></span>
      <span class={`res ${s.powerUsed >= s.powerCap && s.powerCap > 0 ? 'alert' : ''}`} title="Ток: занято / мощность">⚡ {fmt(s.powerUsed)}/{fmt(s.powerCap)}</span>
      <span class="res" title="Вода: занято / мощность">💧 {fmt(s.waterUsed)}/{fmt(s.waterCap)}</span>
      <span class="res" title="Довольство">♥ {s.happiness}%</span>
      <Demand />
      <span class="sep" />
      <span class="date">Месяц {month}, день {dayOfMonth}</span>
      <div class="speed">
        {['❚❚', '▶', '▶▶', '▶▶▶'].map((label, i) => (
          <button class={h.speed === i ? 'active' : ''} onClick={() => actions.setSpeed(i)} title={i ? `Скорость ${i} (клавиша ${i})` : 'Пауза (пробел)'}>{label}</button>
        ))}
      </div>
    </div>
  );
}

function Toolbar({ actions }: { actions: HudActions }) {
  const active = groupOf(tool.value);
  const current = active.tools.find((t) => t.id === tool.value)!;
  return (
    <div class="toolbar">
      {active.tools.length > 1 && (
        <div class="panel sub">
          {active.tools.map((t) => (
            <button class={tool.value === t.id ? 'active' : ''} onClick={() => (tool.value = t.id)}>
              {t.label}
              {t.price && <small>{t.price}</small>}
            </button>
          ))}
        </div>
      )}
      <div class="hint">{current.hint}</div>
      <div class="panel bottom">
        {GROUPS.map((g) => (
          <button class={active.id === g.id ? 'active' : ''} onClick={() => (tool.value = g.tools[0].id)}>
            {g.label}
            {g.tools.length === 1 && g.tools[0].price && <small>{g.tools[0].price}</small>}
          </button>
        ))}
        <span class="sep" />
        <button class={overlay.value === 'power' ? 'active' : ''} onClick={() => (overlay.value = overlay.value === 'power' ? 'none' : 'power')} title="Слой: кто получает ток">⚡ Слой</button>
        <button class={overlay.value === 'water' ? 'active' : ''} onClick={() => (overlay.value = overlay.value === 'water' ? 'none' : 'water')} title="Слой: кто получает воду">💧 Слой</button>
        <span class="sep" />
        <button onClick={actions.undo} disabled={!canUndo.value} title="Ctrl+Z">↶ Отмена</button>
        <button onClick={() => actions.rotate(-1)} title="Q">⟲</button>
        <button onClick={() => actions.rotate(1)} title="E">⟳</button>
        <span class="sep" />
        <button onClick={actions.save} title="Сохраняется и само раз в 30 секунд">Сохранить</button>
        <button onClick={actions.newGame}>Новая игра</button>
      </div>
    </div>
  );
}

function Card() {
  const c = card.value;
  if (!c) return null;
  return (
    <div class="panel card">
      <div class="card-head">
        <b>{c.title}</b>
        <button class="close" onClick={() => (card.value = null)}>×</button>
      </div>
      {c.lines.map((l) => <div class="card-line">{l}</div>)}
    </div>
  );
}

export function Hud({ actions }: { actions: HudActions }) {
  return (
    <>
      <TopBar actions={actions} />
      {message.value && <div class="toast">{message.value}</div>}
      <Card />
      <div class="hover">{hoverInfo.value}</div>
      <Toolbar actions={actions} />
      <div class="help">
        ЛКМ - строить · ПКМ, колесо или пробел+ЛКМ - двигать карту · колесо - приближение · Q/E - поворот · Ctrl+Z - отмена · 1-3 скорость, пробел - пауза
      </div>
    </>
  );
}
