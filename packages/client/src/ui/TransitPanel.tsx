import { TRANSIT } from '@avi/data';
import type { HudActions } from './Hud';
import { hud, tool, transitOpen, flash } from './store';

export function TransitPanel({ actions }: { actions: HudActions }) {
  const h = hud.value;
  if (!transitOpen.value || !h) return null;
  const t = h.transit, limit = TRANSIT.stopLimits[t.expansion], next = t.expansion + 1;
  const label = (id: number) => {
    const i = t.stops.findIndex((s) => s.id === id);
    return `Остановка ${i + 1}`;
  };
  return <div class="panel research transit-panel">
    <div class="tech-head"><b>🚌 Автобусное депо</b><button class="close" onClick={() => (transitOpen.value = false)}>×</button></div>
    {!h.depotReady ? <>
      <p>Постройте депо: один автобус первого уровня на 4 пассажира и три остановки входят в стоимость. Комплект доступен после завершения стройки.</p>
      <button onClick={() => { tool.value = 'b:bus_depot'; transitOpen.value = false; }}>Разместить депо</button>
    </> : <>
      <div class="tech">
        <b>Остановки: {t.stops.length} размещено · {t.tokens} для размещения · предел {limit}</b>
        <div class="transit-buttons">
          <button disabled={!t.tokens} onClick={() => { tool.value = 'busStop'; transitOpen.value = false; flash('Выберите прямую клетку дороги для остановки'); }}>🚏 Поставить остановку</button>
          <button disabled={t.tokens + t.stops.length >= limit || h.money < TRANSIT.stopPrice} onClick={() => actions.transit({ type: 'buyBusStop' })}>Купить остановку · {TRANSIT.stopPrice} ¢</button>
          {next < TRANSIT.stopLimits.length && <button disabled={h.stats.population < TRANSIT.expansionPopulation[next] || h.money < TRANSIT.expansionPrices[next]} onClick={() => actions.transit({ type: 'expandBusStops' })}>
            Предел {TRANSIT.stopLimits[next]} · {TRANSIT.expansionPrices[next]} ¢ · от {TRANSIT.expansionPopulation[next]} жителей
          </button>}
        </div>
        {t.stops.map((s, i) => <div class="transit-row" key={s.id}><span>Остановка {i + 1}</span><button onClick={() => actions.focusStop(s.id)}>На карте</button><button onClick={() => actions.transit({ type: 'removeBusStop', id: s.id })}>Убрать в запас</button></div>)}
      </div>
      <div class="transit-buttons"><b>Автобусы: {t.buses.length}</b><button disabled={t.buses.length >= TRANSIT.maxBuses || h.money < TRANSIT.busPrice} onClick={() => actions.transit({ type: 'buyBus' })}>Купить автобус · {TRANSIT.busPrice} ¢</button></div>
      {t.buses.map((b) => {
        const route = [...b.route];
        const save = (stops: number[]) => actions.transit({ type: 'setBusRoute', id: b.id, stops });
        const move = (i: number, delta: number) => { [route[i], route[i + delta]] = [route[i + delta], route[i]]; save(route); };
        return <div class="tech" key={b.id}>
          <div class="tech-head"><b>Автобус №{b.id} · уровень {b.level} · {TRANSIT.capacity[b.level - 1]} {b.level === 1 ? 'пассажира' : 'пассажиров'}</b>
            {b.level < TRANSIT.capacity.length && <button disabled={h.money < TRANSIT.busUpgradePrices[b.level]} onClick={() => actions.transit({ type: 'upgradeBus', id: b.id })}>Улучшить · {TRANSIT.busUpgradePrices[b.level]} ¢</button>}
          </div>
          <span>{route.length < 2 ? 'Добавьте минимум две остановки для запуска.' : 'Кольцевой маршрут: после последней остановки автобус возвращается к первой.'}</span>
          {route.map((id, i) => <div class="transit-row" key={id}>
            <span>{i + 1}. {label(id)}</span>
            <button disabled={i === 0} onClick={() => move(i, -1)} aria-label="Выше">↑</button>
            <button disabled={i === route.length - 1} onClick={() => move(i, 1)} aria-label="Ниже">↓</button>
            <button onClick={() => save(route.filter((s) => s !== id))} aria-label="Убрать из маршрута">×</button>
          </div>)}
          <select value="" aria-label={`Добавить остановку автобусу ${b.id}`} onChange={(e) => { const id = Number(e.currentTarget.value); if (id) save([...route, id]); e.currentTarget.value = ''; }}>
            <option value="">Добавить остановку в маршрут…</option>
            {t.stops.filter((s) => !route.includes(s.id)).map((s) => <option key={s.id} value={s.id}>{label(s.id)}</option>)}
          </select>
        </div>;
      })}
    </>}
  </div>;
}
