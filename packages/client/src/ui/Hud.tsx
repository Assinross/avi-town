import { BUILDINGS, TECHS, t, techDesc, techName, UFO_BY_ID, type BuildingDef, type Cost } from '@avi/data';
import { DAYS_PER_MONTH, PRICES } from '@avi/sim';
import { alert, canUndo, card, hoverInfo, hud, message, overlay, researchOpen, tool, type Tool } from './store';

export interface HudActions {
  rotate: (step: number) => void;
  setSpeed: (speed: number) => void;
  undo: () => void;
  save: () => void;
  newGame: () => void;
  research: (tech: string) => void;
  assault: () => void;
  focusCrash: () => void;
}

interface ToolDef { id: Tool; label: string; price?: string; hint: string; lockedBy?: string }
interface Group { id: string; label: string; tools: ToolDef[] }

const RES_LABEL: Record<string, string> = { money: '¢', metal: 'мет.', alloys: 'сплав.', elerium: 'элер.', fragments: 'фрагм.' };

function costText(c: Cost): string {
  return Object.entries(c).map(([k, v]) => (k === 'money' ? `${v} ¢` : `${v} ${RES_LABEL[k]}`)).join(' + ');
}

function buildingTool(b: BuildingDef): ToolDef {
  return { id: `b:${b.id}`, label: t(b.nameKey), price: costText(b.cost), hint: t(b.hint), lockedBy: b.requires };
}

const byCategory = (cats: string[]) => BUILDINGS.filter((b) => cats.includes(b.category)).map(buildingTool);

const GROUPS: Group[] = [
  { id: 'inspect', label: 'Осмотр', tools: [{ id: 'inspect', label: 'Осмотр', hint: 'Щелчок по клетке - карточка' }] },
  { id: 'road', label: 'Дороги', tools: [{ id: 'road', label: 'Дорога', price: `${PRICES.road} ¢`, hint: 'Тяни по земле. Дороги несут ток и воду' }] },
  {
    id: 'zones', label: 'Зоны', tools: [
      { id: 'zoneR', label: 'Жильё', price: `${PRICES.zone} ¢/кл`, hint: 'Тяни прямоугольник. Растёт до 2 клеток от дороги' },
      { id: 'zoneC', label: 'Торговля', price: `${PRICES.zone} ¢/кл`, hint: 'Рабочие места и налоги, нужны жители' },
      { id: 'zoneI', label: 'Промзона', price: `${PRICES.zone} ¢/кл`, hint: 'На камнях и заражённой земле добывает металл; загрязняет жильё' },
      { id: 'zoneA', label: 'Фермы', price: `${PRICES.zone} ¢/кл`, hint: 'Еда. Лучше всего на плодородной земле' },
    ],
  },
  { id: 'infra', label: 'Ток, вода, шахты', tools: byCategory(['utility', 'industry']) },
  { id: 'xcom', label: 'XCOM', tools: byCategory(['xcom']) },
  { id: 'defense', label: 'ПВО', tools: byCategory(['defense']) },
  { id: 'bulldoze', label: 'Снос', tools: [{ id: 'bulldoze', label: 'Снос', hint: 'Тяни рамку - снесёт всё внутри' }] },
];

const groupOf = (tl: Tool) => GROUPS.find((g) => g.tools.some((x) => x.id === tl)) ?? GROUPS[0];

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
  const r = h.resources;
  const net = (s.incomeDay - s.upkeepDay) * DAYS_PER_MONTH;
  const month = Math.floor((h.day - 1) / DAYS_PER_MONTH) + 1;
  const dayOfMonth = ((h.day - 1) % DAYS_PER_MONTH) + 1;
  const foodNet = s.foodProd - s.foodUse;
  const tech = h.research.current ? TECHS.find((x) => x.id === h.research.current) : null;
  return (
    <div class="panel top">
      <span class="brand">Avi Town</span>
      <span class="res money" title="Казна и прирост за месяц">¢ {fmt(h.money)} <em class={net >= 0 ? 'pos' : 'neg'}>{signed(net)}</em></span>
      <span class="res" title="Жители / рабочие места">👥 {fmt(s.population)} <em>{fmt(s.jobs)} раб.</em></span>
      <span class={`res ${h.hungerDays > 0 ? 'alert' : ''}`} title="Еда: запас и баланс в день">🌾 {fmt(h.food)} <em class={foodNet >= 0 ? 'pos' : 'neg'}>{signed(foodNet)}</em></span>
      <span class={`res ${s.powerUsed >= s.powerCap && s.powerCap > 0 ? 'alert' : ''}`} title="Ток: занято / мощность">⚡ {fmt(s.powerUsed)}/{fmt(s.powerCap)}</span>
      <span class="res" title="Вода: занято / мощность">💧 {fmt(s.waterUsed)}/{fmt(s.waterCap)}</span>
      <span class="res" title="Металл и прирост в день">⛏ {fmt(r.metal)} <em class="pos">{signed(s.metalPerDay)}</em></span>
      {(r.alloys > 0 || r.elerium > 0 || r.fragments > 0) && (
        <span class="res xcom" title="Трофеи пришельцев: сплавы, элерий, фрагменты оружия">◆ {r.alloys} · ✦ {r.elerium} · ✱ {r.fragments}</span>
      )}
      <span class="res" title="Довольство">♥ {s.happiness}%</span>
      <Demand />
      <button class={`research-btn ${researchOpen.value ? 'active' : ''}`} onClick={() => (researchOpen.value = !researchOpen.value)} title="Исследования XCOM">
        🔬 {tech ? `${techName(tech.id)} ${Math.floor((h.research.progress * 100) / tech.cost)}%` : 'Исследования'}
      </button>
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
  const h = hud.value;
  const done = h?.research.done ?? [];
  const active = groupOf(tool.value);
  const current = active.tools.find((x) => x.id === tool.value) ?? active.tools[0];
  return (
    <div class="toolbar">
      {active.tools.length > 1 && (
        <div class="panel sub">
          {active.tools.map((x) => {
            const locked = !!x.lockedBy && !done.includes(x.lockedBy);
            return (
              <button class={tool.value === x.id ? 'active' : ''} disabled={locked} onClick={() => (tool.value = x.id)} title={locked ? `Нужно исследование: ${techName(x.lockedBy!)}` : x.hint}>
                {locked ? '🔒 ' : ''}{x.label}
                {x.price && <small>{locked ? techName(x.lockedBy!) : x.price}</small>}
              </button>
            );
          })}
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

function ResearchPanel({ actions }: { actions: HudActions }) {
  const h = hud.value;
  if (!researchOpen.value || !h) return null;
  const { done, current, progress } = h.research;
  const r = h.resources;
  return (
    <div class="panel research">
      <div class="card-head">
        <b>Исследования XCOM</b>
        <span class="muted">учёные: {h.stats.researchPerDay} очк./день</span>
        <button class="close" onClick={() => (researchOpen.value = false)}>×</button>
      </div>
      {h.stats.researchPerDay === 0 && <div class="warn">Нет работающей лаборатории: постройте её во вкладке XCOM и подведите ток.</div>}
      <div class="tech-list">
        {TECHS.map((tech) => {
          const isDone = done.includes(tech.id);
          const isCur = current === tech.id;
          const reqOk = tech.requires.every((x) => done.includes(x));
          const items = Object.entries(tech.items) as [keyof typeof r, number][];
          const itemsOk = items.every(([k, v]) => r[k] >= v);
          const state = isDone ? 'done' : isCur ? 'current' : reqOk ? 'open' : 'locked';
          const days = h.stats.researchPerDay ? Math.ceil((tech.cost - (isCur ? progress : 0)) / h.stats.researchPerDay) : null;
          return (
            <div class={`tech ${state}`}>
              <div class="tech-head">
                <b>{techName(tech.id)}</b>
                <span class="muted">{isDone ? 'изучено' : isCur ? `${Math.floor((progress * 100) / tech.cost)}%` : `${tech.cost} очк.${days ? ` · ~${days} дн.` : ''}`}</span>
              </div>
              <div class="tech-desc">{techDesc(tech.id).slice(0, 220)}{techDesc(tech.id).length > 220 ? '…' : ''}</div>
              {!isDone && !reqOk && <div class="muted">Сначала: {tech.requires.filter((x) => !done.includes(x)).map(techName).join(', ')}</div>}
              {!isDone && items.length > 0 && <div class={itemsOk ? 'muted' : 'warn'}>Нужно: {costText(tech.items)}</div>}
              {state === 'open' && (
                <button disabled={!!current || !itemsOk} onClick={() => actions.research(tech.id)}>{current ? 'Учёные заняты' : 'Начать'}</button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

const PHASE: Record<string, string> = { approach: 'приближается', attack: 'атакует город', leave: 'уходит' };

function RaidPanel({ actions }: { actions: HudActions }) {
  const h = hud.value;
  if (!h) return null;
  const raid = h.raid;
  const crash = h.crash;
  if (!raid && !crash) return null;
  return (
    <div class="raid-stack">
      {raid && raid.detected && (
        <div class="panel raid">
          <b>⚠ НЛО: {t(UFO_BY_ID[raid.ufo]?.nameKey ?? raid.ufo)}</b>
          <span class="muted">{PHASE[raid.phase]}</span>
          <div class="hpbar"><div style={{ width: `${Math.max(0, (raid.hp * 100) / raid.maxHp)}%` }} /></div>
        </div>
      )}
      {crash && (
        <div class="panel crash">
          <b>НЛО сбито: {t(UFO_BY_ID[crash.ufo]?.nameKey ?? crash.ufo)}</b>
          <span class="muted">Пришельцы уйдут через {Math.max(0, crash.expiresDay - h.day)} дн.</span>
          <div class="row">
            <button onClick={actions.assault} title="Пока без тактического боя: отряд зачищает место автоматически">Отправить отряд · {PRICES.assault} ¢</button>
            <button onClick={actions.focusCrash}>Показать</button>
          </div>
        </div>
      )}
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
  const h = hud.value;
  return (
    <>
      <TopBar actions={actions} />
      {message.value && <div class="toast">{message.value}</div>}
      {alert.value && <div class="alert">{alert.value}</div>}
      <RaidPanel actions={actions} />
      <ResearchPanel actions={actions} />
      <Card />
      <div class="hover">{hoverInfo.value}</div>
      <Toolbar actions={actions} />
      <div class="help">
        ЛКМ - строить · ПКМ, колесо или пробел+ЛКМ - двигать карту · колесо - приближение · Q/E - поворот · Ctrl+Z - отмена · 1-3 скорость, пробел - пауза
        {h && !h.raid && h.nextRaidDay - h.day <= 5 && h.nextRaidDay > h.day ? ' · ⚠ радиоэфир шумит: скоро налёт' : ''}
      </div>
    </>
  );
}
