import { BUILDINGS, SQUAD, TECHS, t, techDesc, techName, UFO_BY_ID, type BuildingDef, type Cost } from '@avi/data';
import { DAYS_PER_MONTH, PRICES, ZONE_BUILD_DAYS } from '@avi/sim';
import { signal } from '@preact/signals';
import { touchMode } from '../platform/device';
import { alert, canUndo, card, combat, drawer, hoverInfo, hud, message, overlay, researchOpen, selectedUnit, statsOpen, tool, type HudState, type Tool } from './store';

export interface HudActions {
  rotate: (step: number) => void;
  setSpeed: (speed: number) => void;
  undo: () => void;
  save: () => void;
  newGame: () => void;
  research: (tech: string) => void;
  assault: () => void;
  focusCrash: () => void;
  endTurn: () => void;
  retreat: () => void;
  finishMission: () => void;
  selectUnit: (id: number) => void;
  demolish: (x: number, y: number) => void;
}

interface ToolDef { id: Tool; label: string; icon: string; price?: string; hint: string; def?: BuildingDef; info?: string }
interface Group { id: string; label: string; icon: string; tip?: string; tools: ToolDef[] }

const ICON: Record<string, string> = {
  plant: '🏭', pump: '💧', mine: '⛏', lab: '🔬', lab2: '🔬', lab3: '🔬', workshop: '🔧', radar: '📡',
  aa_avalanche: '🚀', aa_phoenix: '🚀', aa_laser: '🔆', aa_plasma: '🟢', aa_fusion: '💥',
};
const TERRAIN_NAME: Record<string, string> = { rock: 'камни', contaminated: 'заражённая земля', soil: 'плодородная земля', wasteland: 'пустошь' };

const RES_LABEL: Record<string, string> = { money: '¢', metal: 'мет.', alloys: 'сплав.', elerium: 'элер.', fragments: 'фрагм.' };

function costText(c: Cost): string {
  return Object.entries(c).map(([k, v]) => (k === 'money' ? `${v} ¢` : `${v} ${RES_LABEL[k]}`)).join(' + ');
}

function buildingTool(b: BuildingDef): ToolDef {
  return { id: `b:${b.id}`, label: t(b.nameKey), icon: ICON[b.id] ?? '🏗', price: costText(b.cost), hint: t(b.hint), def: b };
}

const byCategory = (cats: string[]) => BUILDINGS.filter((b) => cats.includes(b.category)).map(buildingTool);
const zoneInfo = `стройка ${ZONE_BUILD_DAYS[1]}-${ZONE_BUILD_DAYS[3]} дн. на уровень`;

const GROUPS: Group[] = [
  { id: 'inspect', label: 'Осмотр', icon: '🔍', tools: [{ id: 'inspect', label: 'Осмотр', icon: '🔍', hint: 'Щелчок по клетке - карточка' }] },
  { id: 'road', label: 'Дороги', icon: '🛣', tools: [{ id: 'road', label: 'Дорога', icon: '🛣', price: `${PRICES.road} ¢`, hint: 'Тяни по земле. Дороги несут ток и воду' }] },
  {
    id: 'zones', label: 'Зоны', icon: '🏘', tip: 'Разметь землю под жильё, торговлю, промзону или фермы - дома построятся сами', tools: [
      { id: 'zoneR', label: 'Жильё', icon: '🏠', price: `${PRICES.zone} ¢/кл`, info: zoneInfo, hint: 'Тяни прямоугольник. Дом встаёт у дороги, его участок растёт вглубь квартала' },
      { id: 'zoneC', label: 'Торговля', icon: '🏪', price: `${PRICES.zone} ¢/кл`, info: zoneInfo, hint: 'Рабочие места и налоги, нужны жители. Магазины у дороги, рядом парковки' },
      { id: 'zoneI', label: 'Промзона', icon: '🏗', price: `${PRICES.zone} ¢/кл`, info: zoneInfo, hint: 'На камнях и заражённой земле добывает металл; загрязняет жильё' },
      { id: 'zoneA', label: 'Фермы', icon: '🌾', price: `${PRICES.zone} ¢/кл`, info: zoneInfo, hint: 'Еда. Лучше всего на плодородной земле' },
    ],
  },
  { id: 'infra', label: 'Ток, вода, шахты', icon: '⚡', tip: 'Генераторы и насосные отдают ток и воду в сеть дорог; шахты добывают металл', tools: byCategory(['utility', 'industry']) },
  { id: 'xcom', label: 'XCOM', icon: '🛸', tip: 'Лаборатория, мастерская и радар - исследования, ремонт и раннее обнаружение НЛО', tools: byCategory(['xcom']) },
  { id: 'defense', label: 'ПВО', icon: '🎯', tip: 'Зенитные установки сбивают НЛО в своём радиусе', tools: byCategory(['defense']) },
  { id: 'bulldoze', label: 'Снос', icon: '🚧', tools: [{ id: 'bulldoze', label: 'Снос', icon: '🚧', hint: `Тяни рамку - снесёт всё внутри. Недостроенное вернёт ${PRICES.siteRefund}% цены` }] },
];

/** Почему здание сейчас не поставить: блокирующая причина (серая карточка) или null. */
function lockReason(d: BuildingDef, h: HudState): string | null {
  if (d.requires && !h.research.done.includes(d.requires)) return `Нужно исследование: ${techName(d.requires)}`;
  return null;
}

function shortage(d: BuildingDef, h: HudState): string | null {
  const miss = (Object.entries(d.cost) as [string, number][]).filter(([k, v]) => (k === 'money' ? h.money : h.resources[k as keyof HudState['resources']]) < v);
  return miss.length ? `Не хватает: ${miss.map(([k]) => (k === 'money' ? 'денег' : RES_LABEL[k])).join(', ')}` : null;
}

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
  const items: [string, number, string, string][] = [
    ['Ж', h.stats.demand.R, '#7ec850', 'Жильё - растёт, когда рабочих мест больше, чем жителей'],
    ['Т', h.stats.demand.C, '#4fc3ff', 'Торговля - магазинам нужны покупатели-жители'],
    ['П', h.stats.demand.I, '#ffd66b', 'Промзона - рабочие места; на камнях и заражённой земле даёт металл'],
    ['Ф', h.stats.demand.A, '#c9a46a', 'Фермы - еда для жителей'],
  ];
  return (
    <div class="demand">
      {items.map(([k, v, c, what]) => (
        <div class="dcol" title={`Спрос ${k}: ${signed(v)}. ${what}. Выше черты - зона строится, ниже - пустеет`}>
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
      <span class="res" title="Довольство: падает от голода, нехватки воды и тока. От 55% дома растут до 3 уровня">♥ {s.happiness}%</span>
      <Demand />
      <button class={`research-btn ${researchOpen.value ? 'active' : ''}`} onClick={() => (researchOpen.value = !researchOpen.value)} title="Исследования XCOM">
        🔬 {tech ? `${techName(tech.id)} ${Math.floor((h.research.progress * 100) / tech.cost)}%` : 'Исследования'}
      </button>
      <button class={`research-btn ${statsOpen.value ? 'active' : ''}`} onClick={() => (statsOpen.value = !statsOpen.value)} title="Статистика города">📊 Город</button>
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

function ToolCard({ x, h }: { x: ToolDef; h: HudState }) {
  const d = x.def;
  const locked = d ? lockReason(d, h) : null;
  const lack = d && !locked ? shortage(d, h) : null;
  const pick = () => {
    tool.value = x.id;
    drawer.value = null;
  };
  return (
    <button class={`bcard ${tool.value === x.id ? 'active' : ''} ${locked ? 'locked' : ''}`} disabled={!!locked} onClick={pick} title={locked ? undefined : x.hint}>
      <span class="bicon">{locked ? '🔒' : x.icon}</span>
      {locked ? (
        // Неизученное: характеристики скрыты до исследования
        <>
          <b>???</b>
          <small>? ¢ · ? ¢/день · ? дн.</small>
          <small class="why">{locked}</small>
        </>
      ) : <ToolCardBody x={x} lack={lack} />}
    </button>
  );
}

function ToolCardBody({ x, lack }: { x: ToolDef; lack: string | null }) {
  const d = x.def;
  return (
    <>
      <b>{x.label}</b>
      {x.price && <small class={lack ? 'neg' : 'price'}>{x.price}</small>}
      {d && <small>{d.upkeep} ¢/день · {d.buildDays} дн. · {d.size}x{d.size}</small>}
      {x.info && <small>{x.info}</small>}
      {d?.terrain && <small>только: {d.terrain.map((k) => TERRAIN_NAME[k] ?? k).join(', ')}</small>}
      {lack && <small class="why">{lack}</small>}
    </>
  );
}

/** Новая игра - по второму нажатию в течение 3 секунд. */
const confirmNew = signal(false);
let confirmTimer = 0;
function askNewGame(actions: HudActions) {
  clearTimeout(confirmTimer);
  if (confirmNew.value) {
    confirmNew.value = false;
    actions.newGame();
    return;
  }
  confirmNew.value = true;
  confirmTimer = window.setTimeout(() => (confirmNew.value = false), 3000);
}

function Toolbar({ actions }: { actions: HudActions }) {
  const h = hud.value;
  if (!h) return null;
  const active = groupOf(tool.value);
  const current = active.tools.find((x) => x.id === tool.value) ?? active.tools[0];
  const open = GROUPS.find((g) => g.id === drawer.value);
  const choose = (g: Group) => {
    if (g.tools.length === 1) {
      tool.value = g.tools[0].id;
      drawer.value = null;
    } else drawer.value = drawer.value === g.id ? null : g.id;
  };
  return (
    <div class="toolbar">
      {open && (
        <div class="panel drawer">
          <div class="card-head"><b>{open.icon} {open.label}</b><button class="close" onClick={() => (drawer.value = null)}>×</button></div>
          <div class="bcards">{open.tools.map((x) => <ToolCard x={x} h={h} />)}</div>
        </div>
      )}
      <div class="hint">
        <span>{current.icon} <b>{current.label}</b>{current.price ? ` · ${current.price}` : ''} - {current.hint}</span>
        {tool.value !== 'inspect' && <button class="close" onClick={() => (tool.value = 'inspect')} title="Убрать инструмент (Esc)">×</button>}
      </div>
      <div class="panel bottom">
        {GROUPS.map((g) => (
          <button class={`cat ${active.id === g.id || drawer.value === g.id ? 'active' : ''}`} onClick={() => choose(g)} title={g.tip ?? g.tools[0].hint}>
            <span class="bicon">{g.icon}</span>
            {g.label}
          </button>
        ))}
        <span class="sep" />
        <button class={overlay.value === 'power' ? 'active' : ''} onClick={() => (overlay.value = overlay.value === 'power' ? 'none' : 'power')} title="Слой: кто получает ток">⚡ Слой</button>
        <button class={overlay.value === 'water' ? 'active' : ''} onClick={() => (overlay.value = overlay.value === 'water' ? 'none' : 'water')} title="Слой: кто получает воду">💧 Слой</button>
        <span class="sep" />
        <button onClick={actions.undo} disabled={!canUndo.value} title="Отменить последнее действие (Ctrl+Z)">↶ Отмена</button>
        <button onClick={() => actions.rotate(-1)} title="Повернуть карту влево (Q)">⟲</button>
        <button onClick={() => actions.rotate(1)} title="Повернуть карту вправо (E)">⟳</button>
        <span class="sep" />
        <button onClick={actions.save} title="Сохраняется и само раз в 30 секунд">Сохранить</button>
        <button class={confirmNew.value ? 'danger' : ''} onClick={() => askNewGame(actions)} title="Начать новый город; текущий уйдёт в резервную копию">{confirmNew.value ? 'Точно? Ещё раз' : 'Новая игра'}</button>
      </div>
    </div>
  );
}

const ZONE_ROWS: [keyof HudState['summary']['zones'], string][] = [['R', '🏠 Жильё'], ['C', '🏪 Торговля'], ['I', '🏗 Промзона'], ['A', '🌾 Фермы']];

function StatsPanel() {
  const h = hud.value;
  if (!statsOpen.value || !h) return null;
  const s = h.stats;
  const z = h.summary.zones;
  return (
    <div class="panel stats">
      <div class="card-head">
        <b>📊 Город</b>
        <button class="close" onClick={() => (statsOpen.value = false)}>×</button>
      </div>
      <table>
        <tr><th>Зона</th><th>участки</th><th>ур.1</th><th>ур.2</th><th>ур.3</th><th>стройка</th></tr>
        {ZONE_ROWS.map(([k, label]) => (
          <tr><td>{label}</td>{z[k].map((n) => <td>{fmt(n)}</td>)}</tr>
        ))}
      </table>
      <div class="kv"><span>Жители</span><b>{fmt(s.population)}</b></div>
      <div class="kv"><span>Рабочие места</span><b>{fmt(s.jobs)}</b></div>
      <div class="kv"><span>Довольство</span><b>{s.happiness}%</b></div>
      <div class="kv"><span>Ток: занято / мощность</span><b>{fmt(s.powerUsed)} / {fmt(s.powerCap)}</b></div>
      <div class="kv"><span>Вода: занято / мощность</span><b>{fmt(s.waterUsed)} / {fmt(s.waterCap)}</b></div>
      <div class="kv"><span>Еда: в день</span><b>{signed(s.foodProd - s.foodUse)} ({fmt(h.food)} на складе)</b></div>
      <div class="kv"><span>Доход / расход в день</span><b>{fmt(s.incomeDay)} / {fmt(s.upkeepDay)} ¢</b></div>
      <div class="kv"><span>Здания / в стройке</span><b>{h.summary.buildings} / {h.summary.buildingSites}</b></div>
      <div class="kv"><span>Дороги, клеток</span><b>{fmt(h.summary.roads)}</b></div>
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
          const labOk = (h.stats.labTier ?? 0) >= (tech.lab ?? 1);
          const moneyOk = h.money >= (tech.price ?? 0);
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
              {!isDone && !labOk && <div class="warn">Нужна лаборатория яруса {tech.lab}</div>}
              {!isDone && (tech.price > 0 || items.length > 0) && (
                <div class={itemsOk && moneyOk ? 'muted' : 'warn'}>
                  Цена: {fmt(tech.price)} ¢{items.length ? ` · ${costText(tech.items)}` : ''}
                </div>
              )}
              {state === 'open' && (
                <button disabled={!!current || !itemsOk || !labOk || !moneyOk} onClick={() => actions.research(tech.id)}>
                  {current ? 'Учёные заняты' : !labOk ? `Нужна лаб. ярус ${tech.lab}` : !moneyOk ? 'Не хватает денег' : `Начать · ${fmt(tech.price)} ¢`}
                </button>
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
            <button onClick={actions.assault} title="Как вызов пожарных: отряд прибывает, город встаёт на паузу, начинается бой на этой улице">Вызвать отряд · {PRICES.assault} ¢</button>
            <button onClick={actions.focusCrash}>Показать</button>
          </div>
        </div>
      )}
    </div>
  );
}

function Card({ actions }: { actions: HudActions }) {
  const c = card.value;
  if (!c) return null;
  return (
    <div class="panel card">
      <div class="card-head">
        <b>{c.title}</b>
        <button class="close" onClick={() => (card.value = null)}>×</button>
      </div>
      {c.progress !== undefined && <div class="hpbar ok build"><div style={{ width: `${c.progress}%` }} /></div>}
      {c.lines.map((l) => <div class="card-line">{l}</div>)}
      {c.demolish && <button class="demolish" onClick={() => actions.demolish(c.x, c.y)}>🚧 {c.demolish}</button>}
    </div>
  );
}

function CombatHud({ actions }: { actions: HudActions }) {
  const c = combat.value!;
  const squad = c.units.filter((u) => u.side === 'xcom');
  const sel = squad.find((u) => u.id === selectedUnit.value);
  const aliveAliens = c.units.filter((u) => u.side === 'alien' && u.hp > 0).length;
  const resultTitle = { win: 'Победа', lose: 'Отряд погиб', retreat: 'Отступление' }[c.result ?? 'win'];
  const lost = squad.filter((u) => u.hp <= 0).length;
  return (
    <>
      <div class={`panel phase ${c.phase}`}>
        <span>❚❚ Город на паузе</span>
        <span class="tag">{c.phase === 'explore' ? 'Разведка: пришельцы не замечены' : c.phase === 'turn' ? `Ход ${c.turn} · ваш ход` : 'Бой окончен'}</span>
        <span class="muted">НЛО: {t(UFO_BY_ID[c.ufo]?.nameKey ?? c.ufo)} · замечено пришельцев: {c.aliensSeen}{c.phase !== 'explore' ? ` · осталось: ${aliveAliens}` : ''}</span>
      </div>
      <div class="squad">
        {squad.map((u) => (
          <div class={`panel ${u.id === selectedUnit.value ? 'selected' : ''} ${u.hp <= 0 ? 'dead' : ''}`} onClick={() => u.hp > 0 && actions.selectUnit(u.id)}>
            <div class="who"><span>{u.personal ? '★ ' : ''}{u.name.replace(' (вы)', '')}</span><span class="ap">{c.phase === 'turn' && u.hp > 0 ? '●'.repeat(u.ap) + '○'.repeat(2 - u.ap) : ''}</span></div>
            <div class="hpbar ok"><div style={{ width: `${(u.hp * 100) / u.maxHp}%` }} /></div>
          </div>
        ))}
      </div>
      <div class="combat-log">{c.log.map((l) => <div>{l}</div>)}</div>
      {c.phase !== 'result' && (
        <div class="panel combat-bar">
          {sel ? (
            <div class="gear">
              <b>{sel.personal ? '★ ' : ''}{sel.name}</b>
              <span class="muted">{t(SQUAD.soldier.weaponKey)} · {t(SQUAD.soldier.armorKey)} · здоровье {sel.hp}/{sel.maxHp}</span>
            </div>
          ) : <div class="gear muted">Выбери бойца</div>}
          <span class="sep" />
          <span class="muted">{c.phase === 'explore' ? 'ЛКМ - идти (реальное время)' : 'ЛКМ по клетке - ход (голубые 1 очко, жёлтые - рывок) · ЛКМ по пришельцу - выстрел · Tab - следующий'}</span>
          {c.phase === 'turn' && <button onClick={actions.endTurn} title="Enter">Конец хода</button>}
          <button onClick={actions.retreat}>Отступить</button>
        </div>
      )}
      {c.phase === 'result' && (
        <div class={`panel result ${c.result}`}>
          <b>{resultTitle}</b>
          <span>{c.result === 'win' ? 'Трофеи с тарелки отправлены на склад.' : 'Место крушения осталось за пришельцами.'}</span>
          {lost > 0 && <span class="warn">Погибло бойцов: {lost}. Замена: {lost * SQUAD.replacementCost} ¢</span>}
          <button onClick={actions.finishMission}>Вернуться в город</button>
        </div>
      )}
    </>
  );
}

// Всплывающие подсказки: title любого элемента показывается сразу и в стиле игры
const tip = signal<{ text: string; x: number; y: number; bottom: number } | null>(null);
let tipEl: Element | null = null;
function showTip(el: Element) {
  // Свой title переносится в data-tip, чтобы не всплывала ещё и системная подсказка
  const title = el.getAttribute('title');
  if (title) {
    el.setAttribute('data-tip', title);
    el.removeAttribute('title');
  }
  tipEl = el;
  const r = el.getBoundingClientRect();
  tip.value = { text: el.getAttribute('data-tip') ?? '', x: r.left + r.width / 2, y: r.top, bottom: r.bottom };
}
document.addEventListener('pointerover', (e) => {
  const el = (e.target as Element).closest?.('[title], [data-tip]');
  if (!el) return void (tip.value = null);
  showTip(el);
});
document.addEventListener('pointerout', (e) => {
  if (tipEl && !tipEl.contains(e.relatedTarget as Node)) {
    tipEl = null;
    tip.value = null;
  }
});
// На тач-устройствах hover нет: подсказка по тапу, скрытие - тапом мимо
document.addEventListener('pointerdown', (e) => {
  if (e.pointerType !== 'touch') return;
  const el = (e.target as Element).closest?.('[title], [data-tip]');
  if (el) showTip(el);
  else {
    tipEl = null;
    tip.value = null;
  }
});

function Tip() {
  const t = tip.value;
  if (!t || !t.text) return null;
  // Над элементом, а у верхнего края экрана - под ним
  const below = t.y < 80;
  return <div class={`tip ${below ? 'below' : ''}`} style={{ left: `${Math.min(window.innerWidth - 150, Math.max(150, t.x))}px`, top: `${below ? t.bottom + 8 : t.y - 8}px` }}>{t.text}</div>;
}

export function Hud({ actions }: { actions: HudActions }) {
  return (
    <>
      <HudBody actions={actions} />
      <Tip />
    </>
  );
}

function HudBody({ actions }: { actions: HudActions }) {
  const h = hud.value;
  if (combat.value) {
    return (
      <>
        <CombatHud actions={actions} />
        {message.value && <div class="toast">{message.value}</div>}
        <div class="hover right">{hoverInfo.value}</div>
      </>
    );
  }
  return (
    <>
      <div class="topstack">
        <TopBar actions={actions} />
        <div class="hover">{hoverInfo.value}</div>
        <StatsPanel />
      </div>
      {message.value && <div class="toast">{message.value}</div>}
      {alert.value && <div class="alert">{alert.value}</div>}
      <RaidPanel actions={actions} />
      <ResearchPanel actions={actions} />
      <Card actions={actions} />
      <Toolbar actions={actions} />
      <div class="help">
        {touchMode.value
          ? 'Тап - действие · протяжка с инструментом - строить · два пальца - двигать карту · щипок - приближение'
          : 'ЛКМ - строить · ПКМ на месте - сбросить инструмент · ПКМ, колесо или пробел+ЛКМ - двигать карту · колесо - приближение · Q/E - поворот · Ctrl+Z - отмена · 1-3 скорость, пробел - пауза'}
        {h && !h.raid && h.nextRaidDay - h.day <= 5 && h.nextRaidDay > h.day ? ' · ⚠ радиоэфир шумит: скоро налёт' : ''}
      </div>
    </>
  );
}
