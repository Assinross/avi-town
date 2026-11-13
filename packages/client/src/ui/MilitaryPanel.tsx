// Военная экономика в панели бункера: доктрина, склад и заводские заказы.
import { MILITARY, type Cost } from '@avi/data';
import type { MilitaryDoctrine, MilitaryRecipe } from '@avi/sim';
import { hud, type HudState } from './store';

interface MilitaryActions {
  setMilitaryDoctrine: (id: MilitaryDoctrine) => void;
  militaryOrder: (id: MilitaryRecipe) => void;
}

const RESOURCE_NAME: Record<string, string> = {
  metal: 'металл', alloys: 'сплавы', fragments: 'фрагменты', elerium: 'элерий',
};
const fmt = (n: number) => n.toLocaleString('ru-RU');
const costText = (cost: Cost) => Object.entries(cost).map(([key, n]) =>
  key === 'money' ? `${fmt(n ?? 0)} ¢` : `${n} ${RESOURCE_NAME[key] ?? key}`).join(' + ');
function affordable(cost: Cost, h: HudState) {
  return Object.entries(cost).every(([key, n]) =>
    key === 'money' ? h.money >= (n ?? 0) : (h.resources[key as keyof HudState['resources']] ?? 0) >= (n ?? 0));
}

export function MilitaryPanel({ actions }: { actions: MilitaryActions }) {
  const h = hud.value;
  const m = h?.military;
  if (!h || !m) return null;
  const techReady = h.research.done.includes(MILITARY.unlockTech);
  const cooldown = m.doctrineDay === null ? 0 : Math.max(0, MILITARY.switchCooldownDays - (h.day - m.doctrineDay));
  const working = h.militaryWorkshops > 0;
  return (
    <div class="military-panel">
      <div class="sub">⚔ Военная экономика</div>
      <div class="muted">Трофеи НЛО нужны для технологий и военных изделий. Выбери одну специализацию; смена требует нового взноса и времени.</div>
      {!techReady && <div class="warn">Откроется после исследования «Ксенобиология».</div>}
      <div class="military-doctrines">
        {(Object.keys(MILITARY.doctrines) as MilitaryDoctrine[]).map((id) => {
          const branch = MILITARY.doctrines[id];
          const chosen = m.doctrine === id;
          const locked = !techReady || (!chosen && cooldown > 0);
          const tooPoor = !affordable(branch.cost, h);
          return (
            <div class={`military-option ${chosen ? 'chosen' : ''}`}>
              <b>{branch.name}{chosen ? ' ✓' : ''}</b>
              <span class="muted">{branch.description}</span>
              <span class="muted">Цена: {costText(branch.cost)}</span>
              {!chosen && (
                <button disabled={locked || tooPoor} onClick={() => actions.setMilitaryDoctrine(id)}>
                  {!techReady ? 'Нужно исследование' : cooldown > 0 ? `Смена через ${cooldown} дн.`
                    : tooPoor ? 'Не хватает ресурсов' : m.doctrine ? 'Сменить специализацию' : 'Выбрать направление'}
                </button>
              )}
            </div>
          );
        })}
      </div>
      <div class="sub">🔧 Производство в мастерской</div>
      <div class={working ? 'muted' : 'warn'}>
        {working ? `Мастерских с электропитанием: ${h.militaryWorkshops}`
          : 'Для производства построй мастерскую XCOM и обеспечь её электропитанием.'}
      </div>
      <div class="military-stock">
        <span>Оптика: {m.stock.scope}</span>
        <span>Броня: {m.stock.armor}</span>
        <span>Лазеры: {m.stock.laser}</span>
        <span>Боезапас ПВО: {m.stock.aaCharge}</span>
      </div>
      {m.job && (
        <div class={working ? 'muted' : 'warn'}>
          {working ? 'Производится' : 'Пауза — нет работающей мастерской'}:
          {' '}{MILITARY.recipes[m.job.recipe].name} · осталось {m.job.remaining} дн.
        </div>
      )}
      <div class="military-recipes">
        {(Object.keys(MILITARY.recipes) as MilitaryRecipe[]).map((id) => {
          const def = MILITARY.recipes[id];
          const ready = h.research.done.includes(def.requires);
          const poor = !affordable(def.cost, h);
          return (
            <div class="military-recipe">
              <b>{def.name}</b>
              <div class="muted">{def.description} · {def.days} дн.</div>
              <div class={poor ? 'warn' : 'muted'}>Цена: {costText(def.cost)}</div>
              <button disabled={!!m.job || !working || !ready || poor}
                onClick={() => actions.militaryOrder(id)}>
                {m.job ? 'Мастерская занята' : !ready ? 'Нужно исследование' : !working ? 'Нужна мастерская' :
                  poor ? 'Не хватает ресурсов' : 'Произвести'}
              </button>
            </div>
          );
        })}
      </div>
      <div class="muted">Комплекты применяются бесплатно из складского остатка при выборе снаряжения бойца. Боезапас ПВО расходуется автоматически в начале налёта, если есть работающая установка.</div>
    </div>
  );
}
