import { BUILDINGS, ECONOMY, SQUAD, TECHS, t, techDesc, techName, UFO_BY_ID, type BuildingDef, type Cost } from '@avi/data';
import { DAYS_PER_WEEK, PRICES, ZONE_BUILD_DAYS } from '@avi/sim';
import { signal } from '@preact/signals';
import { touchMode } from '../platform/device';
import { alert, budgetOpen, canUndo, card, clock, combat, drawer, flash, hoverInfo, hud, message, overlay, researchOpen, selectedUnit, squadOpen, statsOpen, tool, type CombatState, type CombatUnit, type HudState, type SquadMember, type Tool } from './store';

export interface HudActions {
  rotate: (step: number) => void;
  setSpeed: (speed: number) => void;
  setTax: (rate: number) => void;
  undo: () => void;
  save: () => void;
  newGame: () => void;
  research: (tech: string) => void;
  assault: () => void;
  focusCrash: () => void;
  endTurn: () => void;
  retreat: () => void;
  reload: () => void;
  overwatch: () => void;
  hunker: () => void;
  finishMission: () => void;
  selectUnit: (id: number) => void;
  hire: () => void;
  dismiss: (id: number) => void;
  demolish: (x: number, y: number) => void;
}

interface ToolDef { id: Tool; label: string; icon: string; price?: string; hint: string; def?: BuildingDef; info?: string }
interface Group { id: string; label: string; icon: string; tip?: string; tools: ToolDef[] }

const ICON: Record<string, string> = {
  plant: '🏭', pump: '💧', mine: '⛏', lab: '🔬', lab2: '🔬', lab3: '🔬', workshop: '🔧', radar: '📡', clinic: '🏥', school: '🏫',
  aa_avalanche: '🚀', aa_phoenix: '🚀', aa_laser: '🔆', aa_plasma: '🟢', aa_fusion: '💥',
};
/** Легенда цветов слоёв грязи и услуг: подсказка кнопки и сообщение при включении (на телефоне подсказок нет). */
const LAYER_LEGEND = {
  pollution: 'Грязь: оранжевый - загрязнено (жильё до 1 ур., ферма - половина еды), фиолетовый - заражено навсегда, жёлтый - источник',
  services: 'Услуги: голубой - школа, розовый - лазарет, зелёный - оба (жильё до 3 ур.), красный - жильё без услуг',
};

function toggleLayer(mode: keyof typeof LAYER_LEGEND) {
  overlay.value = overlay.value === mode ? 'none' : mode;
  if (overlay.value === mode) flash(LAYER_LEGEND[mode]);
}

const TERRAIN_NAME: Record<string, string> = { rock: 'камни', contaminated: 'заражённая земля', soil: 'плодородная земля', wasteland: 'пустошь' };

const RES_LABEL: Record<string, string> = { money: '¢', metal: 'мет.', alloys: 'сплав.', elerium: 'элер.', fragments: 'фрагм.' };

function costText(c: Cost): string {
  return Object.entries(c).map(([k, v]) => (k === 'money' ? `${v} ¢` : `${v} ${RES_LABEL[k]}`)).join(' + ');
}

function buildingTool(b: BuildingDef): ToolDef {
  return { id: `b:${b.id}`, label: t(b.nameKey), icon: ICON[b.id] ?? '🏗', price: costText(b.cost), hint: t(b.hint), def: b };
}

const byCategory = (cats: string[]) => BUILDINGS.filter((b) => cats.includes(b.category) && !b.service).map(buildingTool);
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
  { id: 'services', label: 'Услуги', icon: '🏫', tip: 'Школа и лазарет: дома в радиусе обоих растут до 3 уровня и платят больше налогов. Лазарет ещё и лечит бойцов', tools: BUILDINGS.filter((b) => b.service).map(buildingTool) },
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
  const net = (s.incomeDay - s.upkeepDay) * DAYS_PER_WEEK;
  const week = Math.floor((h.day - 1) / DAYS_PER_WEEK) + 1;
  const dayOfWeek = ((h.day - 1) % DAYS_PER_WEEK) + 1;
  const foodNet = s.foodProd - s.foodUse;
  const tech = h.research.current ? TECHS.find((x) => x.id === h.research.current) : null;
  return (
    <div class="panel top">
      <span class="brand">Avi Town</span>
      <button class={`res money ${h.money < 0 ? 'alert' : ''} ${budgetOpen.value ? 'active' : ''}`} onClick={() => (budgetOpen.value = !budgetOpen.value)} title="Казна и прогноз за неделю: налоги и содержание переходят в казну в первый день новой недели. Нажми - бюджет и ставка налога">¢ {fmt(h.money)} <em class={net >= 0 ? 'pos' : 'neg'}>{signed(net)}</em></button>
      <span class="res" title="Жители / рабочие места">👥 {fmt(s.population)} <em>{fmt(s.jobs)} раб.</em></span>
      <span class={`res ${h.hungerDays > 0 ? 'alert' : ''}`} title="Еда: запас и баланс в день">🌾 {fmt(h.food)} <em class={foodNet >= 0 ? 'pos' : 'neg'}>{signed(foodNet)}</em></span>
      <span class={`res ${s.powerUsed >= s.powerCap && s.powerCap > 0 ? 'alert' : ''}`} title="Ток: занято / мощность">⚡ {fmt(s.powerUsed)}/{fmt(s.powerCap)}</span>
      <span class="res" title="Вода: занято / мощность">💧 {fmt(s.waterUsed)}/{fmt(s.waterCap)}</span>
      <span class="res" title="Металл и прирост в день">⛏ {fmt(r.metal)} <em class="pos">{signed(s.metalPerDay)}</em></span>
      {(r.alloys > 0 || r.elerium > 0 || r.fragments > 0) && (
        <span class="res xcom" title="Трофеи пришельцев: сплавы, элерий, фрагменты оружия">◆ {r.alloys} · ✦ {r.elerium} · ✱ {r.fragments}</span>
      )}
      <span class="res" title={`Довольство: падает от голода, нехватки воды и тока, налога выше ${ECONOMY.tax.default}%, безработицы и грязи; растёт от школ и лазаретов. От ${ECONOMY.happiness.level3}% дома рядом со школой и лазаретом растут до 3 уровня`}>♥ {s.happiness}%</span>
      <Demand />
      <button class={`research-btn ${researchOpen.value ? 'active' : ''}`} onClick={toggleResearch} title="Исследования XCOM">
        🔬 {tech ? `${techName(tech.id)} ${Math.floor((h.research.progress * 100) / tech.cost)}%` : 'Исследования'}
      </button>
      <button class={`research-btn ${squadOpen.value ? 'active' : ''}`} onClick={toggleSquad} title="Бойцы XCOM: кто готов к бою, кто лечится и сколько ещё">
        🪖 Отряд {h.squad.filter((x) => x.days === 0).length}/{h.squad.length}
      </button>
      <button class={`research-btn ${statsOpen.value ? 'active' : ''}`} onClick={() => (statsOpen.value = !statsOpen.value)} title="Статистика города">📊 Город</button>
      <span class="sep" />
      <span class="date">Неделя {week}, день {dayOfWeek} из {DAYS_PER_WEEK} · {clock.value}</span>
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
  // Здания, которым нужно неизученное исследование, скрыты - прогрессия открывается постепенно
  const shown = open?.tools.filter((x) => !x.def || !lockReason(x.def, h)) ?? [];
  const hiddenCount = (open?.tools.length ?? 0) - shown.length;
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
          <div class="bcards">{shown.map((x) => <ToolCard x={x} h={h} />)}</div>
          {hiddenCount > 0 && <div class="muted">Ещё зданий: {hiddenCount}. Откроются после исследований.</div>}
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
        <button class={overlay.value === 'pollution' ? 'active' : ''} onClick={() => toggleLayer('pollution')} title={LAYER_LEGEND.pollution}>☣ Грязь</button>
        <button class={overlay.value === 'services' ? 'active' : ''} onClick={() => toggleLayer('services')} title={LAYER_LEGEND.services}>🏫 Услуги</button>
        <span class="sep" />
        <button onClick={actions.undo} disabled={!canUndo.value} title="Отменить последнее действие (Ctrl+Z)">↶ Отмена</button>
        <button onClick={() => actions.rotate(-1)} title="Повернуть карту влево (Q)">⟲</button>
        <button onClick={() => actions.rotate(1)} title="Повернуть карту вправо (E)">⟳</button>
        <span class="sep" />
        <button onClick={actions.save} title="Сохраняется и само раз в 30 секунд">Сохранить</button>
        <button class={confirmNew.value ? 'danger' : ''} onClick={() => askNewGame(actions)} title="Начать новый город; текущий уйдёт в резервную копию">{confirmNew.value ? 'Точно? Ещё раз' : 'Новая игра'}</button>
      </div>
      {/* Подсказка по управлению - в той же колонке, чтобы не налезала на панель */}
      <div class="help">
        {touchMode.value
          ? 'Тап - действие · протяжка с инструментом - строить · два пальца - двигать карту · щипок - приближение'
          : 'ЛКМ - строить · ПКМ на месте - сбросить инструмент · ПКМ, колесо или пробел+ЛКМ - двигать карту · колесо - приближение · Q/E - поворот · Ctrl+Z - отмена · 1-3 скорость, пробел - пауза'}
        {!h.raid && h.nextRaidDay - h.day <= 5 && h.nextRaidDay > h.day ? ' · ⚠ радиоэфир шумит: скоро налёт' : ''}
      </div>
    </div>
  );
}

const INCOME_ROWS: [keyof HudState['budget']['income'], string][] = [
  ['taxR', 'Налог с жителей'], ['taxC', 'Налог с торговли'], ['taxI', 'Налог с промзоны'], ['taxA', 'Налог с ферм'], ['metal', 'Продажа металла'],
];
const EXPENSE_ROWS: [keyof HudState['budget']['expense'], string][] = [
  ['buildings', 'Содержание зданий'], ['defense', 'Содержание ПВО'], ['services', 'Услуги на жителей'], ['roads', 'Дороги'], ['squad', 'Зарплата отряда'], ['interest', 'Проценты по долгу'],
];

/** Бюджет: ставка налога, накопленное за неделю и отчёт за прошлую неделю. */
function BudgetPanel({ actions }: { actions: HudActions }) {
  const h = hud.value;
  if (!budgetOpen.value || !h) return null;
  const b = h.budget;
  const last = b.last;
  const dayOfWeek = ((h.day - 1) % DAYS_PER_WEEK) + 1;
  const cents = (v: number) => Math.floor(v / 100);
  const mood = (ECONOMY.tax.default - b.tax) * ECONOMY.tax.happinessPerPoint;
  const left = ECONOMY.debt.weeks - b.debtWeeks;
  return (
    <div class="panel roster budget">
      <div class="card-head">
        <b>💰 Бюджет</b>
        <span class="muted">день {dayOfWeek} из {DAYS_PER_WEEK}</span>
        <button class="close" onClick={() => (budgetOpen.value = false)}>×</button>
      </div>
      <div class="tax">
        <span>Налог</span>
        <button disabled={b.tax <= ECONOMY.tax.min} onClick={() => actions.setTax(b.tax - 1)}>−</button>
        <b>{b.tax}%</b>
        <button disabled={b.tax >= ECONOMY.tax.max} onClick={() => actions.setTax(b.tax + 1)}>+</button>
        <span class={mood < 0 ? 'warn' : 'muted'}>довольство {signed(mood)}</span>
      </div>
      <div class="muted">Выше налог - больше денег, но жители недовольны и город растёт медленнее. Налог платят только работающие.</div>
      {h.money < 0 && (
        <div class="warn">
          В долгу нельзя строить, только сносить. На долг {ECONOMY.debt.interest}% в неделю.
          {b.debtWeeks > 0 ? ` Долг больше ${fmt(ECONOMY.debt.limit)} ¢ уже ${b.debtWeeks} нед. - до банкротства ${left} нед.` : ` Долг больше ${fmt(ECONOMY.debt.limit)} ¢ ${ECONOMY.debt.weeks} недель подряд - банкротство.`}
        </div>
      )}
      <table>
        <tr><th></th><th>эта неделя</th><th>прошлая</th></tr>
        {INCOME_ROWS.map(([k, label]) => <tr><td>{label}</td><td>+{fmt(cents(b.income[k]))}</td><td>{last ? `+${fmt(last.income[k])}` : '-'}</td></tr>)}
        {EXPENSE_ROWS.map(([k, label]) => <tr><td>{label}</td><td>−{fmt(cents(b.expense[k]))}</td><td>{last ? `−${fmt(last.expense[k])}` : '-'}</td></tr>)}
        <tr><td><b>Итог</b></td><td><b>{signed(cents(Object.values(b.income).reduce((a, v) => a + v, 0) - Object.values(b.expense).reduce((a, v) => a + v, 0)))}</b></td><td><b>{last ? signed(last.net) : '-'}</b></td></tr>
      </table>
      <div class="muted">Безработица {h.stats.unemployment}% · жильё со школой и лазаретом {h.stats.serviced}% · в загрязнении {h.stats.polluted}%</div>
    </div>
  );
}

/** Банкротство - конец игры: время стоит, остаётся начать заново. */
function Bankrupt({ actions }: { actions: HudActions }) {
  const h = hud.value;
  if (!h?.over) return null;
  return (
    <div class="panel gameover">
      <b>Город обанкротился</b>
      <div>{ECONOMY.debt.weeks} недель подряд долг был больше {fmt(ECONOMY.debt.limit)} ¢. Расходы на дома, услуги и ПВО превысили налоги.</div>
      <div class="muted">День {h.day} · жителей {fmt(h.stats.population)} · долг {fmt(-h.money)} ¢</div>
      <button class="danger" onClick={actions.newGame}>Новая игра</button>
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
      <div class="kv"><span>Безработица</span><b>{s.unemployment}%</b></div>
      <div class="kv"><span>Жильё со школой и лазаретом</span><b>{s.serviced}%</b></div>
      <div class="kv"><span>Жильё в загрязнении</span><b>{s.polluted}%</b></div>
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
  // Прогрессия открывается постепенно: видно изученное, текущее и следующий шаг -
  // все предыдущие изучены, а для исследования трофея он уже добыт хоть раз
  const visible = TECHS.filter((tech) => done.includes(tech.id) || current === tech.id || (
    tech.requires.every((x) => done.includes(x))
    && (Object.keys(tech.items) as (keyof typeof r)[]).every((k) => r[k] > 0)
  ));
  const hidden = TECHS.length - visible.length;
  return (
    <div class="panel research">
      <div class="card-head">
        <b>Исследования XCOM</b>
        <span class="muted">учёные: {h.stats.researchPerDay} очк./день</span>
        <button class="close" onClick={() => (researchOpen.value = false)}>×</button>
      </div>
      {h.stats.researchPerDay === 0 && <div class="warn">Нет работающей лаборатории: постройте её во вкладке XCOM и подведите ток.</div>}
      <div class="tech-list">
        {visible.map((tech) => {
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
        {hidden > 0 && <div class="muted">Ещё исследований: {hidden}. Откроются по мере изучения и добычи трофеев пришельцев.</div>}
      </div>
    </div>
  );
}

// Исследования и отряд открываются на одном месте экрана - одно окно за раз
function toggleResearch() {
  researchOpen.value = !researchOpen.value;
  squadOpen.value = false;
}
function toggleSquad() {
  squadOpen.value = !squadOpen.value;
  researchOpen.value = false;
}

/** Состояние бойца строкой: в строю, лечение или тяжёлое ранение со сроком. Без рода - в отряде и мужчины, и женщины. */
function healText(x: SquadMember): string {
  if (x.days === 0) return 'в строю';
  return `${x.down ? 'тяжёлое ранение' : 'лечение'} · ещё ${x.days} дн.`;
}

/** Через сколько дней здоровых станет достаточно для вызова; 0 - уже хватает. */
function daysUntilSquad(squad: SquadMember[]): number {
  const waits = squad.map((x) => x.days).sort((a, b) => a - b);
  return waits[SQUAD.minSquad - 1] ?? Infinity;
}

/** Увольнение - по второму нажатию в течение 3 секунд. */
const confirmDismiss = signal(0);
let dismissTimer = 0;
function askDismiss(actions: HudActions, id: number) {
  clearTimeout(dismissTimer);
  if (confirmDismiss.value === id) {
    confirmDismiss.value = 0;
    actions.dismiss(id);
    return;
  }
  confirmDismiss.value = id;
  dismissTimer = window.setTimeout(() => (confirmDismiss.value = 0), 3000);
}

function SquadPanel({ actions }: { actions: HudActions }) {
  const h = hud.value;
  if (!squadOpen.value || !h) return null;
  const ready = h.squad.filter((x) => x.days === 0).length;
  const spare = Math.max(0, h.squad.length - SQUAD.size);
  const full = h.squad.length >= SQUAD.maxRoster;
  const broke = h.money < SQUAD.hireCost;
  return (
    <div class="panel roster">
      <div class="card-head">
        <b>🪖 Отряд XCOM</b>
        <span class="muted">готовы {ready} из {h.squad.length}</span>
        <button class="close" onClick={() => (squadOpen.value = false)}>×</button>
      </div>
      <div class="muted">На миссию идут до {SQUAD.size} здоровых бойцов, нужно хотя бы {SQUAD.minSquad}. Раненые лечатся на базе.</div>
      {h.stats.healRate > 1
        ? <div class="muted">🏥 Лазарет работает: лечение в {h.stats.healRate} раза быстрее</div>
        : <div class="warn">Нет работающего лазарета - раненые лечатся медленно. Построй его во вкладке "Услуги" и подведи ток.</div>}
      <div class="roster-list">
        {h.squad.map((x) => (
          <div class={`soldier ${x.days ? 'hurt' : ''}`}>
            <div class="soldier-head">
              <b>{x.personal ? '★ ' : ''}{x.name}</b>
              <span class={x.days ? 'warn' : 'muted'}>{healText(x)}</span>
              {!x.personal && (
                <button class={`close ${confirmDismiss.value === x.id ? 'danger' : ''}`} onClick={() => askDismiss(actions, x.id)} title="Уволить бойца (нажми ещё раз для подтверждения)">
                  {confirmDismiss.value === x.id ? 'Уволить?' : '×'}
                </button>
              )}
            </div>
            <div class="hpbar ok"><div style={{ width: `${(x.hp * 100) / x.maxHp}%` }} /></div>
          </div>
        ))}
      </div>
      {spare > 0 && <div class="muted">Зарплата запасных: {spare * SQUAD.salary} ¢/день</div>}
      <button disabled={full || broke} onClick={actions.hire} title={`Запасной боец заменит раненых. Зарплата ${SQUAD.salary} ¢/день за каждого сверх ${SQUAD.size}`}>
        {full ? `В отряде уже ${SQUAD.maxRoster} бойцов` : broke ? 'Не хватает денег на наём' : `Нанять бойца · ${fmt(SQUAD.hireCost)} ¢ + ${SQUAD.salary} ¢/день`}
      </button>
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
  const ready = h.squad.filter((x) => x.days === 0).length;
  const wait = daysUntilSquad(h.squad);
  const left = crash ? Math.max(0, crash.expiresDay - h.day) : 0;
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
          <span class="muted">Пришельцы уйдут через {left} дн.</span>
          {ready >= SQUAD.minSquad
            ? <span class="muted">На миссию пойдут бойцов: {Math.min(ready, SQUAD.size)}{ready < h.squad.length ? ` · лечатся: ${h.squad.length - ready}` : ''}</span>
            : <span class="warn">Здоровых бойцов {ready}, нужно {SQUAD.minSquad}. Хватит через {wait} дн.{wait > left ? ' - пришельцы уйдут раньше' : ''}</span>}
          <div class="row">
            <button disabled={ready < SQUAD.minSquad} onClick={actions.assault} title={ready < SQUAD.minSquad ? 'Мало здоровых бойцов: дождись выздоровления или найми бойца в панели "Отряд"' : 'Как вызов пожарных: отряд прибывает, город встаёт на паузу, начинается бой на этой улице'}>Вызвать отряд · {PRICES.assault} ¢</button>
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

/** Текст укрытия бойца: 80 - присед удвоил полное укрытие. */
const COVER_TEXT: Record<number, string> = { 0: 'нет - фланг', 20: 'половинное', 40: 'полное', 80: 'полное + присед' };

/** Почему действие бойца недоступно; null - кнопка активна. Условия повторяют проверки симуляции. */
function reloadWhy(u: CombatUnit | undefined, phase: CombatState['phase']): string | null {
  if (phase !== 'turn') return 'Сейчас не ваш ход';
  if (!u || u.hp <= 0) return 'Выбери бойца';
  if (u.overwatch || u.hunkered) return 'Сейчас нельзя';
  if (u.mag === 0) return 'Оружие без магазина';
  if (u.ammo >= u.mag) return 'Магазин полон';
  if (u.ap < 1) return 'Не хватает очков действия';
  return null;
}

function overwatchWhy(u: CombatUnit | undefined, phase: CombatState['phase']): string | null {
  if (phase !== 'turn') return 'Сейчас не ваш ход';
  if (!u || u.hp <= 0) return 'Выбери бойца';
  if (u.overwatch) return 'Уже на наблюдении';
  if (u.hunkered) return 'Присел в укрытии';
  if (u.mag > 0 && u.ammo === 0) return 'Нет патронов';
  if (u.ap < 1) return 'Не хватает очков действия';
  return null;
}

function hunkerWhy(u: CombatUnit | undefined, phase: CombatState['phase']): string | null {
  if (phase !== 'turn') return 'Сейчас не ваш ход';
  if (!u || u.hp <= 0) return 'Выбери бойца';
  if (u.overwatch) return 'Уже на наблюдении';
  if (u.hunkered) return 'Уже присел';
  if (u.ap < 1) return 'Не хватает очков действия';
  if (!u.adjacentCover) return 'Рядом нет укрытия';
  return null;
}

function CombatHud({ actions }: { actions: HudActions }) {
  const c = combat.value!;
  const squad = c.units.filter((u) => u.side === 'xcom');
  const sel = squad.find((u) => u.id === selectedUnit.value);
  const aliveAliens = c.units.filter((u) => u.side === 'alien' && u.hp > 0).length;
  const resultTitle = { win: 'Победа', lose: 'Отряд эвакуирован', retreat: 'Отступление' }[c.result ?? 'win'];
  const down = squad.filter((u) => u.hp <= 0).length;
  const wounded = squad.filter((u) => u.hp > 0 && u.hp < u.maxHp).length;
  const noReload = reloadWhy(sel, c.phase);
  const noWatch = overwatchWhy(sel, c.phase);
  const noDuck = hunkerWhy(sel, c.phase);
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
            {u.hp > 0
              ? <div class="hpbar ok"><div style={{ width: `${(u.hp * 100) / u.maxHp}%` }} /></div>
              : <small class="down" title="Выбывает до конца боя, после боя - лечение">✚ тяжёлое ранение</small>}
          </div>
        ))}
      </div>
      <div class="combat-log">{c.log.map((l) => <div>{l}</div>)}</div>
      {c.phase !== 'result' && (
        <div class="panel combat-bar">
          {sel ? (
            <div class="gear">
              <b>{sel.personal ? '★ ' : ''}{sel.name}</b>
              <span class="muted">{t(SQUAD.soldier.weaponKey)} · {t(SQUAD.soldier.armorKey)} · патроны {sel.mag > 0 ? `${sel.ammo}/${sel.mag}` : '∞'} · здоровье {sel.hp}/{sel.maxHp}</span>
              <span class="muted">укрытие: {COVER_TEXT[sel.cover]}{sel.overwatch ? ' · наблюдение' : ''}{sel.hunkered ? ' · присел' : ''}</span>
            </div>
          ) : <div class="gear muted">Выбери бойца</div>}
          <span class="sep" />
          <div class="tac-act">
            <button disabled={!!noReload} onClick={actions.reload} title={noReload ?? 'R - перезарядка: полный магазин за 1 очко'}>🔄 Перезарядка{noReload && <small>{noReload}</small>}</button>
            <button class={sel?.overwatch ? 'active' : ''} disabled={!!noWatch} onClick={actions.overwatch} title={noWatch ?? 'O - наблюдение: выстрел по врагу, вошедшему в сектор'}>👁 Наблюдение{noWatch && <small>{noWatch}</small>}</button>
            <button class={sel?.hunkered ? 'active' : ''} disabled={!!noDuck} onClick={actions.hunker} title={noDuck ?? 'C - присед: усилить укрытие, забирает оставшиеся очки'}>🛡 Присед{noDuck && <small>{noDuck}</small>}</button>
          </div>
          <span class="sep" />
          <span class="muted">{c.phase === 'explore' ? 'ЛКМ - идти (реальное время)' : 'ЛКМ по клетке - ход (голубые 1 очко, жёлтые - рывок) · ЛКМ по пришельцу - выстрел · Tab - следующий · R, O, C - перезарядка, наблюдение, присед'}</span>
          {c.phase === 'turn' && <button onClick={actions.endTurn} title="Enter">Конец хода</button>}
          <button onClick={actions.retreat}>Отступить</button>
        </div>
      )}
      {c.phase === 'result' && (
        <div class={`panel result ${c.result}`}>
          <b>{resultTitle}</b>
          <span>{c.result === 'win' ? 'Трофеи с тарелки отправлены на склад.' : 'Место крушения осталось за пришельцами.'}</span>
          {(wounded > 0 || down > 0) && <span class="warn">Ранены: {wounded}, тяжело: {down}. Они пропустят следующие вылеты, пока не вылечатся - сроки в панели "Отряд".</span>}
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
      <SquadPanel actions={actions} />
      <BudgetPanel actions={actions} />
      <Card actions={actions} />
      <Bankrupt actions={actions} />
      <Toolbar actions={actions} />
    </>
  );
}
