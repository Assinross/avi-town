import { effect } from '@preact/signals';
import { render } from 'preact';
import * as THREE from 'three';
import { BUILDING_BY_ID, ECONOMY, SQUAD, t as tr, techName, UFO_BY_ID, WASTELAND } from '@avi/data';
import {
  applyCommand, applyTactical, builtLevel, CAPACITY, decodeLot, dist, isFrontage, lotCells, usesLots, canSee, canZone, checkBuilding, coverOf, createWorld, deserialize, hasAdjacentCover, hasRoadNear, History, hitChance,
  awaySoldiers, bunkerCenter, convoyEta, daysToHeal, expeditionCost, expeditionPath, irradiated, magOf, moveCost, newWasteland, PERSONAL_ID, PRICES, rosterCap, serialize, soldierHp, SPEED_FACTOR, step, tacticalTick, TICK_HZ, TICKS_PER_DAY, tileAt, ZONE_BUILD_DAYS,
  type Command, type GameEvent, type Mission, type ReasonCode, type TacCommand, type TacUnit, type World, type ZoneType,
} from '@avi/sim';
import { CameraRig } from './input/cameraRig';
import { attachGestures } from './input/gestures';
import { qualityProfile } from './platform/device';
import { loadModels } from './render/models';
import { loadCharacters } from './render/characters';
import { loadCivilians } from './render/civilians';
import { loadBattleProps } from './render/battleProps';
import { PHASE_NAME, phaseAt } from './render/dayCycle';
import { SceneView } from './render/sceneView';
import { Hud, UPGRADE_TEXT } from './ui/Hud';
import { SITE_ICON, SITE_NAME } from './render/wastelandView';
import { bunkerOpen, canUndo, card, clock, combat, drawer, flash, hoverInfo, hud, overlay, raiseAlert, researchOpen, scoutCount, selectedUnit, squadOpen, statsOpen, tool, type CitySummary, type CombatUnit, type TileCard, type Tool } from './ui/store';

const SAVE_KEY = 'avi-town.save';

const REASONS: Record<ReasonCode, string> = {
  out_of_map: 'За краем карты',
  no_money: 'Не хватает денег',
  blocked: 'Место занято - сначала снос',
  no_road: 'Нужна дорога рядом',
  nothing: 'Здесь нечего делать',
  water: 'Нельзя строить на воде',
  no_resources: 'Не хватает ресурсов',
  wrong_terrain: 'Нужна другая земля (шахта - на камнях или заражённой земле)',
  not_researched: 'Сначала нужно исследование',
  no_lab: 'Нужна лаборатория',
  busy: 'Учёные уже заняты',
  no_squad: `Мало здоровых бойцов: нужно хотя бы ${SQUAD.minSquad}. Дождись выздоровления или найми бойца`,
  squad_full: `В отряде уже ${SQUAD.maxRoster} бойцов - больше не нанять`,
  game_over: 'Город обанкротился - начни новую игру',
  unknown: 'Неизвестное действие',
  fog: 'Неизвестная земля - сначала разведай: стройся рядом или отправь экспедицию',
  radiation: 'Радиоактивное пятно - здесь строить нельзя',
  no_path: 'Броневику туда не проехать: путь перегородили дома',
  no_bunker: 'Нужен бункер',
  no_food: 'Не хватает еды в дорогу',
};
const TERRAIN: Record<string, string> = {
  wasteland: 'Пустошь', soil: 'Плодородная земля', contaminated: 'Заражённая земля', water: 'Вода', rock: 'Камни',
};
const OBJECT: Record<string, string> = {
  none: '', road: 'дорога', ruin: 'руины', tree: 'дерево', rubble: 'завал', zone: '', building: '', crash: 'НЛО',
};
const ZONE_NAME: Record<ZoneType, string> = { R: 'Жильё', C: 'Торговля', I: 'Промзона', A: 'Ферма' };
const ZONE_TOOLS: Partial<Record<Tool, ZoneType>> = { zoneR: 'R', zoneC: 'C', zoneI: 'I', zoneA: 'A' };
const buildDef = (t: Tool) => (t.startsWith('b:') ? t.slice(2) : null);
const objectName = (t: { object: string; def: string | null }) =>
  t.object === 'building' && t.def ? tr(BUILDING_BY_ID[t.def]?.nameKey ?? t.def) : OBJECT[t.object];

// --- Мир: загрузка сохранения или новая игра ------------------------------------------------
const params = new URLSearchParams(location.search);
/** Новая игра - выход из бункера; ?sandbox - старая песочница без тумана и бункера. */
function freshWorld(seed: number): World {
  return params.has('sandbox') ? createWorld(seed, 64) : newWasteland(seed, 64);
}
function loadOrCreate(): World {
  if (!params.get('seed')) {
    let raw: string | null = null;
    try {
      raw = localStorage.getItem(SAVE_KEY);
      if (raw) {
        const res = deserialize(raw);
        if (res.ok) return res.world;
        backupSave(raw, res.reason);
      }
    } catch (e) {
      // Упала миграция или хранилище недоступно
      if (raw) backupSave(raw, String(e));
    }
  }
  return freshWorld(Number(params.get('seed')) || 2026);
}

/** Сохранение не загрузилось - копия в сторону, чтобы автосохранение нового мира её не затёрло. */
function backupSave(raw: string, reason: string) {
  try {
    localStorage.setItem(`${SAVE_KEY}.backup-${Date.now()}`, raw);
  } catch { /* места нет - хотя бы предупредим */ }
  setTimeout(() => raiseAlert(`Сохранение не загрузилось (${reason}) - копия отложена, начат новый город`), 500);
}
let world = loadOrCreate();
// Игра всегда стартует на паузе: игрок сам решает, когда пустить время
world.speed = 0;
// Отладка ночи: ?hour=22 ставит видимое время суток на старте; сохранение не пишется
const hourArg = params.get('hour');
const debugHourValue = hourArg === null || hourArg === '' ? NaN : Number(hourArg);
const debugHour = Number.isFinite(debugHourValue) && debugHourValue >= 0 && debugHourValue < 24 ? debugHourValue : null;
let history = new History();

function save(silent = false) {
  try {
    localStorage.setItem(SAVE_KEY, serialize(world));
    if (!silent) flash('Игра сохранена');
  } catch {
    if (!silent) flash('Не удалось сохранить: хранилище браузера недоступно');
  }
}

await loadModels();
await loadCharacters();
await loadCivilians();
await loadBattleProps();
const canvas = document.getElementById('scene') as HTMLCanvasElement;
const view = new SceneView(canvas, world, document.getElementById('labels')!, qualityProfile());
const rig = new CameraRig(world.size);
if (debugHour !== null) view.cycle.set(debugHour);

/** Подтверждение - в самой кнопке (Hud), системный confirm() встроенный браузер глушит. */
function newGame() {
  // Текущий город - в резервную копию, на случай если нажали зря
  try {
    localStorage.setItem(`${SAVE_KEY}.backup-${Date.now()}`, serialize(world));
  } catch { /* хранилище недоступно */ }
  world = freshWorld((Date.now() & 0x7fffffff) >>> 0);
  world.speed = 0;
  history = new History();
  canUndo.value = false;
  view.setWorld(world);
  card.value = null;
  focusBunker();
  save(true);
}

/** Камера на бункер: с него начинается игра. */
function focusBunker() {
  const c = bunkerCenter(world);
  if (!c) return;
  rig.target.set(c.x + 0.5, 0, c.y + 0.5);
  rig.zoomBy(2.2 / rig.camera.zoom);
}

/** Выбор цели экспедиции: инструмент на карте, щелчок по клетке отправляет бойцов. */
function pickExpedition() {
  tool.value = 'expedition';
  bunkerOpen.value = false;
  drawer.value = null;
  card.value = null;
}

function sendExpedition(c: Cell) {
  const res = run({ type: 'sendExpedition', x: c.x, y: c.y, soldiers: scoutCount.value });
  if (!res.ok) return;
  flash(`Экспедиция вышла: бойцов ${res.count}, ${res.cost} ¢. Ушедшие не смогут штурмовать, пока не вернутся`);
  tool.value = 'inspect';
  hoverInfo.value = '';
  view.setPreview([]);
}

function setSpeed(speed: number) {
  applyCommand(world, { type: 'setSpeed', speed });
}

function focusCrash() {
  if (!world.crash) return;
  rig.target.set(world.crash.x + 0.5, 0, world.crash.y + 0.5);
  rig.zoomBy(2.5 / rig.camera.zoom);
}

render(
  <Hud actions={{
    rotate: (s) => rig.rotate(s), setSpeed, undo, save: () => save(), newGame, focusCrash,
    setTax: (rate) => run({ type: 'setTax', rate }),
    research: (tech) => {
      const res = run({ type: 'startResearch', tech });
      if (res.ok) flash(`Учёные взялись за "${techName(tech)}"`);
    },
    assault: () => {
      // С бункером броневик сначала едет; бой (и камера на нём) - когда доедет
      if (run({ type: 'assaultCrash' }).ok && !world.mission) flash('Броневик выехал из бункера');
    },
    endTurn: () => tac({ type: 'tacEndTurn' }),
    retreat: () => tac({ type: 'tacRetreat' }),
    reload: () => tac({ type: 'tacReload', unit: selectedUnit.value }),
    overwatch: () => tac({ type: 'tacOverwatch', unit: selectedUnit.value }),
    hunker: () => tac({ type: 'tacHunker', unit: selectedUnit.value }),
    finishMission: () => {
      tac({ type: 'tacFinish' });
      rig.zoomBy(2.2 / rig.camera.zoom);
    },
    selectUnit,
    hire: () => {
      const res = run({ type: 'hireSoldier' });
      if (res.ok) flash(`Новый боец в отряде: ${world.soldiers[world.soldiers.length - 1].name}`);
    },
    dismiss: (id) => {
      const name = world.soldiers.find((s) => s.id === id)?.name;
      if (run({ type: 'dismissSoldier', id }).ok) flash(`${name} покидает отряд`);
    },
    demolish: (x, y) => {
      const res = run({ type: 'bulldoze', rect: { x0: x, y0: y, x1: x, y1: y } });
      if (res.ok) flash(res.cost < 0 ? `Стройка свёрнута, возвращено ${-res.cost} ¢` : `Снесено за ${res.cost} ¢`);
    },
    upgradeBunker: (id) => {
      if (run({ type: 'upgradeBunker', id }).ok) flash(`Бункер: строится "${UPGRADE_TEXT[id]?.name ?? id}"`);
    },
    assaultSite: (id) => {
      if (run({ type: 'assaultSite', site: id }).ok) {
        card.value = null;
        flash('Броневик выехал к гнезду');
      }
    },
    pickExpedition,
    focusBunker,
  }} />,
  document.getElementById('ui')!,
);
effect(() => view.setOverlay(overlay.value));
if (import.meta.env.DEV) Object.assign(window, { avi: { get world() { return world; }, rig, run: (c: Command) => run(c), tac: (c: TacCommand) => tac(c), selectUnit, view } });

function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  view.setSize(w, h);
  rig.resize(w, h);
}
window.addEventListener('resize', resize);
resize();

// --- Выбор клетки и инструменты ---------------------------------------------------------------
const raycaster = new THREE.Raycaster();
const ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const hit = new THREE.Vector3();
type Cell = { x: number; y: number };

function tileFromPointer(e: { clientX: number; clientY: number }): Cell | null {
  const ndc = new THREE.Vector2((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
  raycaster.setFromCamera(ndc, rig.camera);
  if (!raycaster.ray.intersectPlane(ground, hit)) return null;
  const x = Math.floor(hit.x), y = Math.floor(hit.z);
  return tileAt(world, x, y) ? { x, y } : null;
}

// Клетки между двумя точками протягивания без диагональных разрывов - дорога остаётся связной
function* tileLine(a: Cell, b: Cell) {
  let { x, y } = a;
  const dx = Math.abs(b.x - x), dy = Math.abs(b.y - y);
  const sx = Math.sign(b.x - x), sy = Math.sign(b.y - y);
  for (let ix = 0, iy = 0; ix < dx || iy < dy; ) {
    // Шаг по той оси, вдоль которой отрезок "отстаёт" сильнее; деление на 0 даёт Infinity
    if ((0.5 + ix) / dx < (0.5 + iy) / dy) { x += sx; ix++; } else { y += sy; iy++; }
    yield { x, y };
  }
}

function rectCells(a: Cell, b: Cell): Cell[] {
  const out: Cell[] = [];
  for (let y = Math.min(a.y, b.y); y <= Math.max(a.y, b.y); y++) {
    for (let x = Math.min(a.x, b.x); x <= Math.max(a.x, b.x); x++) out.push({ x, y });
  }
  return out;
}

const isRectTool = (t: Tool) => t in ZONE_TOOLS || t === 'bulldoze';

// --- Тактический бой ----------------------------------------------------------------------------
const TAC_REASONS: Record<string, string> = {
  no_mission: 'Боя нет', not_your_turn: 'Сейчас нельзя', no_ap: 'Не хватает очков действия',
  unreachable: 'Туда не пройти', no_los: 'Цель не видна', dead: 'Цель или боец уже выбыли',
  no_ammo: 'Нет патронов', no_cover: 'Нужно укрытие', busy: 'Сейчас нельзя', nothing: 'Ничего не произошло',
};

/**
 * Укрытие бойца против ближайшего видимого врага: то же, что покажет подсказка при наведении.
 * Врагов не видно - 0: со стороны неизвестного противника укрытия нет.
 * Видимость берём отрядом (vis), а не личным обзором canSee: у присевшего обзор падает
 * до 6 клеток, и враг в 7-12 клетках пропал бы - панель показала бы "нет - фланг" в укрытии.
 */
function coverAgainstNearest(m: Mission, u: TacUnit): CombatUnit['cover'] {
  let nearest: TacUnit | null = null;
  let best = Infinity;
  for (const a of m.units) {
    if (a.side === u.side || a.hp <= 0 || !view.tactical.vis[a.y * m.w + a.x]) continue;
    const d = dist(a, u);
    if (d < best) { best = d; nearest = a; }
  }
  return nearest ? coverOf(m, u, nearest) : 0;
}

function tac(cmd: TacCommand) {
  const res = applyTactical(world, cmd);
  if (!res.ok) flash(TAC_REASONS[res.reason]);
  // После хода - следующий боец с очками действия
  const m = world.mission;
  const sel = m?.units.find((u) => u.id === selectedUnit.value);
  if (m && m.phase === 'turn' && (!sel || sel.ap === 0 || sel.hp <= 0)) {
    const next = m.units.find((u) => u.side === 'xcom' && u.hp > 0 && u.ap > 0);
    if (next) selectUnit(next.id);
  }
  return res;
}

function selectUnit(id: number) {
  selectedUnit.value = id;
  view.tactical.selected = id;
  if (world.mission) view.tactical.rebuildOverlays(world.mission);
}

function enterMission() {
  const m = world.mission;
  if (!m || !world.crash) return;
  card.value = null;
  researchOpen.value = false;
  squadOpen.value = false;
  rig.target.set(world.crash.x + 0.5, 0, world.crash.y + 0.5);
  rig.zoomBy(8 / rig.camera.zoom);
  const first = m.units.find((u) => u.side === 'xcom');
  if (first) selectUnit(first.id);
}

function tacCell(e: { clientX: number; clientY: number }, m: Mission) {
  const ndc = new THREE.Vector2((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
  raycaster.setFromCamera(ndc, rig.camera);
  if (!raycaster.ray.intersectPlane(ground, hit)) return null;
  return view.tactical.cellAt(m, hit.x, hit.z);
}

function tacClick(e: { clientX: number; clientY: number }, m: Mission) {
  const c = tacCell(e, m);
  if (!c) return flash('За пределами зоны боя');
  const at = m.units.find((u) => u.hp > 0 && u.x === c.x && u.y === c.y);
  if (at?.side === 'xcom') return selectUnit(at.id);
  const sel = m.units.find((u) => u.id === selectedUnit.value && u.hp > 0);
  if (!sel) return flash('Выбери бойца');
  if (at?.side === 'alien' && view.tactical.vis[at.y * m.w + at.x]) {
    if (m.phase !== 'turn') return;
    tac({ type: 'tacShoot', unit: sel.id, target: at.id });
    return;
  }
  tac({ type: 'tacMove', unit: sel.id, x: c.x, y: c.y });
}

function tacHover(e: { clientX: number; clientY: number }, m: Mission) {
  const c = tacCell(e, m);
  if (!c) return (hoverInfo.value = '');
  const sel = m.units.find((u) => u.id === selectedUnit.value && u.hp > 0);
  const at = m.units.find((u) => u.hp > 0 && u.x === c.x && u.y === c.y);
  if (at?.side === 'alien' && view.tactical.vis[at.y * m.w + at.x]) {
    const name = tr(at.name);
    if (!sel) return (hoverInfo.value = name);
    const cover = coverOf(m, at, sel);
    // 80 - присевший пришелец: coverOf удваивает укрытие, иначе подсказка противоречила бы шансу в той же строке
    const coverText = cover === 80 ? 'полное укрытие + присед' : cover === 40 ? 'полное укрытие' : cover === 20 ? 'половинное укрытие' : 'без укрытия - фланг!';
    hoverInfo.value = canSee(m, sel, at)
      ? `${name}: шанс попадания ${hitChance(m, sel, at)}% · ${coverText}`
      : `${name}: не на линии огня`;
    return;
  }
  if (sel && m.phase === 'turn') {
    const cost = moveCost(m, sel, c.x, c.y);
    hoverInfo.value = cost < 0 ? 'Туда не пройти' : cost === 1 ? 'Ход: 1 очко' : 'Рывок: 2 очка';
  } else hoverInfo.value = '';
}

let dragStart: Cell | null = null;
/** Протяжка дороги: строим только при отпускании - начало растяжки, roadCur - последняя виденная клетка. */
let roadStart: Cell | null = null;
let roadCur: Cell | null = null;
let panning = false;
/** Где нажата правая кнопка: щелчок без движения сбрасывает инструмент. */
let rightDown: { x: number; y: number } | null = null;
let spaceHeld = false;
let spacePanned = false;
let last = { x: 0, y: 0 };

function run(cmd: Command, silent = false) {
  const res = applyCommand(world, cmd, history);
  if (!res.ok && !silent) flash(REASONS[res.reason]);
  canUndo.value = history.canUndo;
  return res;
}

function undo() {
  if (history.undo(world)) flash('Действие отменено');
  canUndo.value = history.canUndo;
}

// Клетка дороги: земля без занятого объекта; nth - номер по линии, серым подсветим, когда денег уже не хватает
function roadOk(cur: Cell, nth: number): boolean {
  const tile = tileAt(world, cur.x, cur.y)!;
  return tile.terrain !== 'water' && ['none', 'tree', 'rubble', 'road'].includes(tile.object) && world.money >= nth * PRICES.road;
}

function updatePreview(cur: Cell | null) {
  const t = tool.value;
  if (!cur) return view.setPreview([]);
  if (t === 'expedition') {
    // Путь экспедиции от бункера: голубой - по карману, красный - не хватает денег или еды
    const c = bunkerCenter(world);
    if (!c) return view.setPreview([]);
    const cost = expeditionCost(world, cur.x, cur.y);
    const ok = cost.money <= world.money && cost.food <= world.food;
    view.setPreview(expeditionPath(world, cur.x, cur.y).slice(1).map((i) => ({ x: i % world.size, y: Math.floor(i / world.size), ok })));
    hoverInfo.value = `Экспедиция: ${cost.cells} кл. · ${cost.money} ¢ · еда ${cost.food} · туда и обратно ~${Math.round((cost.cells * 2 * (world.research.done.includes(WASTELAND.expedition.fastTech) ? WASTELAND.expedition.fastTicksPerCell : WASTELAND.expedition.ticksPerCell)) / TICKS_PER_DAY)} дн.`;
    return;
  }
  if (dragStart && isRectTool(t)) {
    const zone = ZONE_TOOLS[t];
    view.setPreview(rectCells(dragStart, cur).map((c) => {
      const tile = tileAt(world, c.x, c.y)!;
      return { ...c, ok: !!world.explored[c.y * world.size + c.x] && (zone ? canZone(tile, zone) && !irradiated(world, c.x, c.y) : tile.object !== 'none') };
    }));
    return;
  }
  if (roadStart) {
    // Протяжка дороги - линия от точки нажатия до курсора, старт тоже в превью
    view.setPreview([{ ...roadStart, ok: roadOk(roadStart, 1) }, ...[...tileLine(roadStart, cur)].map((c, i) => ({ ...c, ok: roadOk(c, i + 2) }))]);
    return;
  }
  const def = buildDef(t);
  if (def) {
    const ok = checkBuilding(world, def, cur.x, cur.y).ok;
    const b = BUILDING_BY_ID[def];
    const size = b?.size ?? 1;
    const cells: (Cell & { ok: boolean; area?: boolean })[] = [];
    // Радиус действия (ПВО - круг, школа и лазарет - квадрат) - жёлтым вокруг места постройки
    const range = b?.aa?.range ?? b?.service?.radius ?? 0;
    const c = (size - 1) / 2;
    for (let dy = -range; dy <= range + size - 1; dy++) {
      for (let dx = -range; dx <= range + size - 1; dx++) {
        const inside = dx >= 0 && dy >= 0 && dx < size && dy < size;
        if (inside || (!b?.service && (dx - c) ** 2 + (dy - c) ** 2 > range * range) || !tileAt(world, cur.x + dx, cur.y + dy)) continue;
        cells.push({ x: cur.x + dx, y: cur.y + dy, ok: true, area: true });
      }
    }
    for (let dy = 0; dy < size; dy++) for (let dx = 0; dx < size; dx++) cells.push({ x: cur.x + dx, y: cur.y + dy, ok });
    view.setPreview(cells);
    return;
  }
  const ok = t === 'road' ? roadOk(cur, 1) : true;
  view.setPreview([{ ...cur, ok }]);
}

/** Применение протяжки дороги одним шагом отмены: линия от нажатия до to. */
function applyRoad(from: Cell, to: Cell) {
  history.beginGroup(world);
  let built = 0, cost = 0;
  let fail: ReasonCode | null = null;
  // Неудача первой клетки даёт flash с причиной; дальше молча - деньги могли кончиться
  for (const s of [from, ...tileLine(from, to)]) {
    const res = run({ type: 'buildRoad', ...s }, built > 0);
    if (res.ok) {
      built++;
      cost += res.cost ?? 0;
    } else fail = res.reason;
  }
  history.endGroup();
  canUndo.value = history.canUndo;
  if (built) flash(`Построено дорог: ${built} · ${cost} ¢`);
  else if (fail) flash(REASONS[fail]);
}

/** Конец протяжки дороги: строит линию до последней клетки сброса и убирает предпросмотр. */
function finishRoad(c: Cell | null) {
  if (!roadStart) return;
  const to = roadCur ?? c;
  if (to) applyRoad(roadStart, to);
  roadStart = null;
  roadCur = null;
}

const BULLDOZE_FREE = new Set(['none', 'crash']);

function describe(c: Cell): TileCard {
  if (!world.explored[c.y * world.size + c.x]) {
    return { title: 'Неизвестная земля', lines: ['Туман войны: здесь ещё никто не был', 'Стройся рядом - туман отступит, или отправь экспедицию из бункера'], x: c.x, y: c.y };
  }
  // Любая клетка участка показывает дом целиком - по главной клетке
  const at = tileAt(world, c.x, c.y)!;
  if (at.object === 'zone' && usesLots(at) && at.root >= 0) c = { x: at.root % world.size, y: Math.floor(at.root / world.size) };
  const t = tileAt(world, c.x, c.y)!;
  const lines = [`${TERRAIN[t.terrain]} · [${c.x}, ${c.y}]`];
  let title = objectName(t) || TERRAIN[t.terrain];
  let progress: number | undefined;
  let demolish = BULLDOZE_FREE.has(t.object) ? undefined : 'Снести';
  if (t.object === 'zone' && t.zone) {
    const lvl = builtLevel(t);
    const lot = decodeLot(t.lot);
    const cells = lot ? lotCells(world, t.root).length : 1;
    const deep = usesLots(t) && !lot && !isFrontage(world, c.x, c.y);
    title = `${ZONE_NAME[t.zone]}${lvl ? ` · уровень ${lvl}` : ' · пустой участок'}`;
    if (lot) lines.push(`Участок ${lot.w}x${lot.d}: дом, двор${t.zone === 'R' && t.level === 1 ? ', дорожка с машиной' : ''}${t.level === 3 || t.zone === 'C' ? ', парковка' : ''}`);
    if (deep) lines.push('Дом растёт от улицы; эту клетку займёт участок соседнего дома, когда он вырастет');
    if (t.build > 0) {
      progress = Math.floor(((ZONE_BUILD_DAYS[t.level] - t.build) * 100) / ZONE_BUILD_DAYS[t.level]);
      lines.push(`🏗 Строится уровень ${t.level}: осталось ${t.build} дн.`);
    }
    const cap = CAPACITY[t.zone][lvl] * cells;
    if (lvl) lines.push(t.zone === 'R' ? `Жителей: ${cap}` : `Рабочих мест: ${cap}`);
    lines.push(`Ток: ${t.powered ? 'есть' : 'нет'} · Вода: ${t.watered ? 'есть' : 'нет'}`);
    const why: string[] = [];
    if (!deep) {
      if (!hasRoadNear(world, c.x, c.y, 2)) why.push('нет дороги ближе 2 клеток');
      if (t.zone !== 'A' && !t.powered) why.push('нет тока - поставь генератор у дороги');
      if (!t.watered) why.push('без воды выше 1 уровня не вырастет');
      if (world.stats.demand[t.zone] <= 0) why.push('нет спроса на этот тип зоны');
      if (t.terrain === 'contaminated' && t.zone !== 'I') why.push('заражённая земля - максимум 1 уровень');
    }
    if (why.length) lines.push('Мешает: ' + why.join('; '));
  } else if (t.object === 'building' && t.def) {
    const def = BUILDING_BY_ID[t.def];
    const root = world.tiles[t.root];
    if (root.build > 0) {
      progress = Math.floor(((def.buildDays - root.build) * 100) / def.buildDays);
      lines.push(`🏗 Стройка: осталось ${root.build} из ${def.buildDays} дн. Пока не достроено - не работает`);
      demolish = `Свернуть стройку · вернуть ${Math.floor(((def.cost.money ?? 0) * PRICES.siteRefund) / 100)} ¢`;
    } else demolish = `Снести · ${PRICES.bulldoze.building} ¢`;
    lines.push(`Прочность: ${t.hp}/${def.hp}${t.hp < def.hp ? ' - мастерская починит' : ''}`);
    if (def.needsPower) lines.push(`Ток: ${t.powered ? 'есть' : 'нет - подведи дорогу от генератора'}`);
    if (def.power) lines.push(`Даёт ${def.power} ед. тока в сеть дорог`);
    if (def.water) lines.push(`Даёт воду: у реки ${def.water.river}, колодец ${def.water.well}`);
    if (def.research) lines.push(`Исследования: +${def.research} очк./день`);
    if (def.metalPerDay) lines.push(`Металл: +${def.metalPerDay}/день`);
    if (def.radar) lines.push('Замечает НЛО при появлении и ставит игру на паузу');
    if (def.aa) lines.push(`Радиус ${def.aa.range} кл. · урон ${def.aa.damage} · точность ${def.aa.accuracy}%`);
    if (def.id === 'bunker' && world.bunker) {
      const ups = world.bunker.upgrades.map((id) => UPGRADE_TEXT[id]?.name ?? id);
      lines.push(`Казарма: ${world.soldiers.length} из ${rosterCap(world)} бойцов`);
      lines.push(ups.length ? `Улучшения: ${ups.join(', ')}` : 'Улучшений нет - панель "Бункер" вверху');
      if (world.bunker.work) lines.push(`🏗 Строится: ${UPGRADE_TEXT[world.bunker.work.id]?.name}, ещё ${world.bunker.work.days} дн.`);
      lines.push('Отсюда выезжает броневик отряда. Бетон не разрушить до конца');
      demolish = undefined;
    }
    if (def.garage && def.id !== 'bunker') lines.push('Гараж броневика: отряд выезжает из ближайшего гаража');
    lines.push(`Содержание: ${def.upkeep} ¢/день`);
  } else {
    title = title.charAt(0).toUpperCase() + title.slice(1);
    if (t.object === 'ruin') lines.push(`Довоенные руины: снос даёт ${WASTELAND.ruins.metal} металла`);
    else if (t.object === 'rubble') lines.push('Снеси, чтобы освободить место');
    if (t.object === 'crash') lines.push(world.crash?.landed ? 'Десант пришельцев громит дома вокруг - вышли отряд!' : 'Отправь отряд, пока пришельцы не ушли');
  }
  // Находка на клетке или рядом
  let nest: number | undefined;
  for (const site of world.sites) {
    if (!site.found || site.done || Math.abs(site.x - c.x) > 1 || Math.abs(site.y - c.y) > 1) continue;
    title = `${SITE_ICON[site.kind]} ${SITE_NAME[site.kind]}`;
    if (site.kind === 'metal') lines.push(`Шахта рядом с залежью добывает металла в ${WASTELAND.sites.metal.multiplier} раза больше`);
    if (site.kind === 'spring') lines.push('Насосная рядом с источником качает воду, как у реки');
    if (site.kind === 'radiation') lines.push('В центре пятна строить нельзя, земля вокруг заражена');
    if (site.kind === 'nest') {
      lines.push('Гнездо пришельцев: охрана сильнее экипажа малой тарелки, трофеи богаче');
      nest = site.id;
    }
  }
  if (irradiated(world, c.x, c.y) && !lines.some((l) => l.includes('пятна'))) lines.push('☢ Радиация: строить нельзя');
  return { title, lines, x: c.x, y: c.y, progress, demolish, nest };
}

function summarize(): CitySummary {
  const zones: CitySummary['zones'] = { R: [0, 0, 0, 0, 0], C: [0, 0, 0, 0, 0], I: [0, 0, 0, 0, 0], A: [0, 0, 0, 0, 0] };
  let buildings = 0, buildingSites = 0, roads = 0;
  world.tiles.forEach((t, i) => {
    if (t.object === 'road') roads++;
    else if (t.object === 'zone' && t.zone) {
      zones[t.zone][builtLevel(t)]++;
      if (t.build > 0) zones[t.zone][4]++;
    } else if (t.object === 'building' && t.root === i) {
      if (t.build > 0) buildingSites++;
      else buildings++;
    }
  });
  return { zones, buildings, buildingSites, roads };
}

canvas.addEventListener('contextmenu', (e) => e.preventDefault());
canvas.addEventListener('pointerdown', (e) => {
  // Тач-события ведёт модуль жестов (attachGestures ниже)
  if (e.pointerType === 'touch') return;
  canvas.setPointerCapture(e.pointerId);
  last = { x: e.clientX, y: e.clientY };
  if (e.button === 1 || e.button === 2 || (e.button === 0 && spaceHeld)) {
    // Панорама во время протяжки дороги отменяет её без стройки
    roadStart = null;
    roadCur = null;
    panning = true;
    rightDown = e.button === 2 ? { x: e.clientX, y: e.clientY } : null;
    if (spaceHeld) spacePanned = true;
    return;
  }
  if (world.mission) {
    if (e.button === 0) tacClick(e, world.mission);
    return;
  }
  const c = tileFromPointer(e);
  if (!c) return;
  const t = tool.value;
  if (t === 'inspect') {
    card.value = describe(c);
  } else if (t === 'expedition') {
    if (e.button === 0) sendExpedition(c);
  } else if (t === 'road') {
    roadStart = c;
  } else if (isRectTool(t)) {
    dragStart = c;
  } else if (buildDef(t)) {
    run({ type: 'placeBuilding', def: buildDef(t)!, ...c });
  }
  updatePreview(c);
});

canvas.addEventListener('pointermove', (e) => {
  if (e.pointerType === 'touch') return;
  if (panning) {
    rig.pan(e.clientX - last.x, e.clientY - last.y, window.innerHeight);
    last = { x: e.clientX, y: e.clientY };
    return;
  }
  if (world.mission) {
    view.setPreview([]);
    return tacHover(e, world.mission);
  }
  const c = tileFromPointer(e);
  updatePreview(c);
  if (tool.value === 'expedition') return;
  if (c && !world.explored[c.y * world.size + c.x]) hoverInfo.value = 'Неизвестная земля';
  else if (c) {
    const tile = tileAt(world, c.x, c.y)!;
    const site = tile.build > 0 || (tile.root >= 0 && world.tiles[tile.root].build > 0) ? ' · стройка' : '';
    const obj = (tile.object === 'zone' && tile.zone ? `${ZONE_NAME[tile.zone]}${builtLevel(tile) ? ' ур. ' + builtLevel(tile) : ''}` : objectName(tile)) + site;
    hoverInfo.value = `${TERRAIN[tile.terrain]}${obj ? ' · ' + obj : ''}`;
  } else hoverInfo.value = '';
  if (roadStart) roadCur = c;
});

canvas.addEventListener('pointerup', (e) => {
  if (e.pointerType === 'touch') return;
  if (panning) {
    panning = false;
    // Правый щелчок на месте - обратно к простому указателю
    if (rightDown && e.button === 2 && Math.hypot(e.clientX - rightDown.x, e.clientY - rightDown.y) < 5 && !world.mission) {
      tool.value = 'inspect';
      drawer.value = null;
      dragStart = null;
      updatePreview(tileFromPointer(e));
    }
    rightDown = null;
    return;
  }
  const c = tileFromPointer(e);
  const t = tool.value;
  if (dragStart && c) {
    const rect = { x0: dragStart.x, y0: dragStart.y, x1: c.x, y1: c.y };
    const zone = ZONE_TOOLS[t];
    const res = zone ? run({ type: 'zone', rect, zone }) : run({ type: 'bulldoze', rect });
    if (res.ok && res.cost) flash(`${zone ? 'Зонировано' : 'Снесено'}: ${res.count} кл. за ${res.cost} ¢`);
  }
  finishRoad(c);
  dragStart = null;
  updatePreview(c);
});

canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  rig.zoomBy(e.deltaY < 0 ? 1.15 : 1 / 1.15);
}, { passive: false });

// --- Тач-ввод: жесты поверх Pointer Events (десктопная мышь идёт по обработчикам выше) --
/** Клетка по экранным координатам - жесты отдают клиентские пиксели. */
const cellAt = (x: number, y: number) => tileFromPointer({ clientX: x, clientY: y });

attachGestures(canvas, {
  tap: (x, y) => {
    if (world.mission) return tacClick({ clientX: x, clientY: y }, world.mission);
    const c = cellAt(x, y);
    if (!c) return;
    const t = tool.value;
    if (t === 'inspect') card.value = describe(c);
    else if (t === 'expedition') sendExpedition(c);
    else if (t === 'road') {
      history.beginGroup(world);
      run({ type: 'buildRoad', ...c });
      history.endGroup();
      canUndo.value = history.canUndo;
    } else if (isRectTool(t)) {
      // Тап зоной/сносом - одна клетка
      const zone = ZONE_TOOLS[t];
      const res = zone ? run({ type: 'zone', rect: { x0: c.x, y0: c.y, x1: c.x, y1: c.y }, zone })
        : run({ type: 'bulldoze', rect: { x0: c.x, y0: c.y, x1: c.x, y1: c.y } });
      if (res.ok && res.cost) flash(`${zone ? 'Зонировано' : 'Снесено'}: ${res.count} кл. за ${res.cost} ¢`);
    } else if (buildDef(t)) {
      run({ type: 'placeBuilding', def: buildDef(t)!, ...c });
    }
  },
  panStart: () => { panning = true; },
  panMove: (dx, dy) => rig.pan(dx, dy, window.innerHeight),
  panEnd: () => { panning = false; },
  buildStart: (x, y) => {
    if (world.mission) return;
    const c = cellAt(x, y);
    if (!c) return;
    const t = tool.value;
    if (t === 'road') {
      roadStart = c;
    } else if (isRectTool(t)) dragStart = c;
    else if (buildDef(t)) run({ type: 'placeBuilding', def: buildDef(t)!, ...c });
    updatePreview(c);
  },
  buildMove: (x, y) => {
    if (world.mission) return;
    const c = cellAt(x, y);
    updatePreview(c);
    if (roadStart) roadCur = c;
  },
  buildEnd: (x, y) => {
    if (world.mission) return;
    const c = cellAt(x, y);
    if (dragStart && c) {
      const rect = { x0: dragStart.x, y0: dragStart.y, x1: c.x, y1: c.y };
      const zone = ZONE_TOOLS[tool.value];
      const res = zone ? run({ type: 'zone', rect, zone }) : run({ type: 'bulldoze', rect });
      if (res.ok && res.cost) flash(`${zone ? 'Зонировано' : 'Снесено'}: ${res.count} кл. за ${res.cost} ¢`);
    }
    finishRoad(c);
    dragStart = null;
    updatePreview(c);
  },
  buildCancel: () => {
    // Второй палец: дорога ещё не построена - просто сбрасываем протяжку
    roadStart = null;
    roadCur = null;
    dragStart = null;
    view.setPreview([]);
  },
  zoom: (f) => rig.zoomBy(f),
}, { isInspect: () => tool.value === 'inspect' && !world.mission });

const keys = new Set<string>();
/** Фокус в поле ввода - боевые горячие клавиши не перехватываем, чтобы не мешать печати. */
function isTyping(e: KeyboardEvent) {
  const el = e.target as HTMLElement | null;
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
}
window.addEventListener('keydown', (e) => {
  keys.add(e.code);
  if ((e.ctrlKey || e.metaKey) && e.code === 'KeyZ') {
    e.preventDefault();
    undo();
    return;
  }
  if (e.code === 'Space') {
    e.preventDefault();
    if (!spaceHeld) { spaceHeld = true; spacePanned = false; }
    return;
  }
  if (world.mission) {
    const m = world.mission;
    if (e.code === 'Tab') {
      e.preventDefault();
      const alive = m.units.filter((u) => u.side === 'xcom' && u.hp > 0);
      const i = alive.findIndex((u) => u.id === selectedUnit.value);
      if (alive.length) selectUnit(alive[(i + 1) % alive.length].id);
    }
    if (e.code === 'Enter' && m.phase === 'turn') tac({ type: 'tacEndTurn' });
    if (m.phase === 'turn' && !isTyping(e)) {
      // R/O/C действуют только в бою: в городе R - это дорога
      const unit = selectedUnit.value;
      if (e.code === 'KeyR') { e.preventDefault(); tac({ type: 'tacReload', unit }); }
      if (e.code === 'KeyO') { e.preventDefault(); tac({ type: 'tacOverwatch', unit }); }
      if (e.code === 'KeyC') { e.preventDefault(); tac({ type: 'tacHunker', unit }); }
    }
  }
  if (e.code === 'KeyQ') rig.rotate(-1);
  if (e.code === 'KeyE') rig.rotate(1);
  if (e.code === 'Digit1' || e.code === 'Digit2' || e.code === 'Digit3') setSpeed(Number(e.code.slice(-1)));
  if (e.code === 'KeyR' && !world.mission) tool.value = 'road';
  if (e.code === 'KeyB') tool.value = 'bulldoze';
  if (e.code === 'KeyI' || e.code === 'Escape') {
    tool.value = 'inspect';
    dragStart = null;
    researchOpen.value = false;
    squadOpen.value = false;
    drawer.value = null;
    statsOpen.value = false;
  }
});
window.addEventListener('keyup', (e) => {
  keys.delete(e.code);
  if (e.code === 'Space') {
    // Короткое нажатие пробела без перетаскивания - пауза/продолжить
    if (!spacePanned) setSpeed(world.speed === 0 ? 1 : 0);
    spaceHeld = false;
  }
});

// --- События симуляции -> оповещения ---------------------------------------------------------
const ufoName = (id: string) => tr(UFO_BY_ID[id]?.nameKey ?? id);
function announce(e: GameEvent) {
  switch (e.type) {
    case 'raidDetected': return raiseAlert(`⚠ Радар: к городу летит ${ufoName(e.ufo)}. Игра на паузе - готовь ПВО`);
    case 'raidArrived': return raiseAlert(`⚠ Над городом НЛО: ${ufoName(e.ufo)}! Построй радар, чтобы замечать их заранее`);
    case 'ufoDown': return raiseAlert(`✦ ${ufoName(e.ufo)} сбит и упал в городе! Отправь отряд к месту крушения`);
    case 'ufoLeft': return flash(`${ufoName(e.ufo)} ушёл. Ремонт - в мастерской`);
    case 'buildingDestroyed': return flash('НЛО разрушило здание');
    case 'researchDone': return raiseAlert(`🔬 Исследование завершено: ${techName(e.tech)}`);
    case 'crashExpired': return flash(`Пришельцы покинули место крушения (${ufoName(e.ufo)}) - трофеи потеряны`);
    case 'crashCleared': {
      const s = e.salvage;
      return raiseAlert(`Место крушения зачищено. Трофеи: ${s.money ?? 0} ¢, сплавы ${s.alloys ?? 0}, элерий ${s.elerium ?? 0}, фрагменты ${s.fragments ?? 0}${woundText(e)}`);
    }
    case 'missionFailed':
      return raiseAlert(`${e.retreat ? 'Отряд отступил' : 'Отряд эвакуирован'}. Пришельцы остались у тарелки${woundText(e)}`);
    case 'soldierRecovered': return flash(`${e.name}: лечение окончено, снова в строю`);
    case 'weekReport': {
      const r = e.report;
      if (r.debtWeeks > 0) return raiseAlert(`⚠ Неделя ${r.week}: долг ${-world.money} ¢ больше предела ${r.debtWeeks} нед. подряд. Ещё ${ECONOMY.debt.weeks - r.debtWeeks} - и город банкрот`);
      return flash(`Неделя ${r.week} закрыта: ${r.net >= 0 ? '+' : ''}${r.net} ¢ - отчёт в панели бюджета`);
    }
    case 'bankrupt': return raiseAlert('Город обанкротился: долг больше предела слишком долго');
    case 'siteFound': return announceSite(e);
    case 'expeditionBack':
      return raiseAlert(`🎒 Экспедиция вернулась: находок ${e.found}${e.wounded ? `, ранены ${e.wounded} - сроки в панели "Отряд"` : ''}`);
    case 'bunkerUpgraded': return raiseAlert(`🛡 Бункер: готово "${UPGRADE_TEXT[e.id]?.name ?? e.id}"`);
    case 'convoyBack': return flash('Броневик вернулся в бункер');
    case 'convoyTurned': return flash('Цель исчезла - броневик поворачивает назад');
    case 'convoyArrived': return;
    case 'ufoLanded': return raiseAlert(`⚠ ${ufoName(e.ufo)} сел в городе! Десант громит дома вокруг - высылай отряд`);
    case 'nestCleared': {
      const s = e.salvage;
      return raiseAlert(`👾 Гнездо зачищено. Трофеи: ${s.money ?? 0} ¢, сплавы ${s.alloys ?? 0}, элерий ${s.elerium ?? 0}, фрагменты ${s.fragments ?? 0}${woundText(e)}`);
    }
  }
}

/** Находка в пустоши: что нашли и что это дало. */
function announceSite(e: Extract<GameEvent, { type: 'siteFound' }>) {
  const r = e.reward;
  const what = SITE_NAME[e.kind];
  switch (e.kind) {
    case 'cache': return raiseAlert(`📦 ${what}: ${r.money ? `${r.money} ¢` : `${r.metal} металла`}`);
    case 'archive': return raiseAlert(r.research ? `📜 ${what}: исследование "${techName(r.research)}" продвинулось на половину` : `📜 ${what}: следующее исследование начнётся с половины`);
    case 'survivors': return raiseAlert(r.soldier ? `🧑‍🤝‍🧑 ${what}: ${r.soldier} вступает в отряд` : `🧑‍🤝‍🧑 ${what}: мест в казарме нет, они отдали припасы - ${r.money} ¢`);
    default: return flash(`${SITE_ICON[e.kind]} Найдено: ${what}`);
  }
}

/** Бойцы, о тяжёлом ранении которых уже сказали в этом бою. */
const downShown = new Set<number>();
/** Тяжёлое ранение - всплывающим сообщением: на телефоне журнал боя скрыт. */
function announceDown(m: Mission | null) {
  if (!m) return downShown.clear();
  const fresh = m.units.filter((u) => u.side === 'xcom' && u.hp <= 0 && !downShown.has(u.id));
  if (!fresh.length) return;
  fresh.forEach((u) => downShown.add(u.id));
  flash(`✚ ${fresh.map((u) => u.name.replace(' (вы)', '')).join(', ')}: тяжёлое ранение, выбывает из боя`);
}

function woundText(e: { wounded: number; down: number }) {
  if (!e.wounded && !e.down) return '';
  return `. На лечении: ранены ${e.wounded}, тяжело ${e.down} - сроки в панели "Отряд"`;
}

// --- Цикл: симуляция по реальному времени, отрисовка, автосохранение -------------------------
let prev = performance.now();
let tickAcc = 0;
let tacAcc = 0;
let hudRevision = -1;
let lastSave = performance.now();
let inMission = !!world.mission;
/** Тики игрового времени -> часы. */
const toHours = (ticks: number) => Math.max(0, Math.round((ticks * 24) / TICKS_PER_DAY));
window.addEventListener('beforeunload', () => { if (debugHour === null) save(true); });

function frame(now: number) {
  const dt = Math.min((now - prev) / 1000, 0.1);
  prev = now;
  tickAcc += dt * TICK_HZ * SPEED_FACTOR[world.speed];
  const ticks = Math.min(Math.floor(tickAcc), 400);
  tickAcc -= ticks;
  if (ticks > 0) step(world, ticks);
  if (world.mission) {
    // Разведка идёт в реальном времени, даже когда город на паузе
    tacAcc += dt * TICK_HZ;
    while (tacAcc >= 1) {
      tacAcc -= 1;
      tacticalTick(world);
    }
  }
  if (world.events.length) {
    // Налёт меняет мир не через игрока - старые шаги отмены больше не применимы
    if (world.events.some((e) => e.type !== 'researchDone' && e.type !== 'soldierRecovered')) {
      history.clear();
      canUndo.value = false;
    }
    world.events.forEach(announce);
    world.events.length = 0;
  }

  const panStep = 600 * dt;
  if (keys.has('KeyW') || keys.has('ArrowUp')) rig.pan(0, panStep, window.innerHeight);
  if (keys.has('KeyS') || keys.has('ArrowDown')) rig.pan(0, -panStep, window.innerHeight);
  if (keys.has('KeyA') || keys.has('ArrowLeft')) rig.pan(panStep, 0, window.innerHeight);
  if (keys.has('KeyD') || keys.has('ArrowRight')) rig.pan(-panStep, 0, window.innerHeight);
  rig.update(dt);

  view.render(rig.camera, dt);
  // В шапке - время суток словом: смена дня и ночи только картинка, часы бы спорили с датой
  const time = PHASE_NAME[phaseAt(view.cycle.hour)];
  if (clock.value !== time) clock.value = time;
  // Бой начался (броневик доехал) - камера на место боя
  if (world.mission && !inMission) enterMission();
  inMission = !!world.mission;
  if (hudRevision !== world.revision) {
    hudRevision = world.revision;
    const awaySet = awaySoldiers(world);
    const u = world.raid?.ufo;
    hud.value = {
      money: world.money, food: world.food, day: world.day, speed: world.speed, hungerDays: world.hungerDays,
      stats: { ...world.stats, demand: { ...world.stats.demand } },
      resources: { ...world.resources },
      research: { ...world.research, done: [...world.research.done] },
      raid: u && world.raid ? { ufo: u.def, hp: u.hp, maxHp: u.maxHp, phase: u.phase, detected: world.raid.detected } : null,
      crash: world.crash ? { ...world.crash } : null,
      nextRaidDay: world.nextRaidDay,
      summary: summarize(),
      squad: world.soldiers.map((s) => {
        const hp = soldierHp(s);
        const away = world.convoy?.soldiers.includes(s.id) ? 'convoy' as const : awaySet.has(s.id) ? 'expedition' as const : null;
        return { id: s.id, name: s.name, hp, maxHp: SQUAD.soldier.hp, days: daysToHeal(world, s), down: hp === 0, personal: s.id === PERSONAL_ID, away };
      }),
      budget: { ...world.budget, income: { ...world.budget.income }, expense: { ...world.budget.expense } },
      over: world.over,
      bunker: world.bunker ? { upgrades: [...world.bunker.upgrades], work: world.bunker.work ? { ...world.bunker.work } : null, roster: rosterCap(world) } : null,
      convoy: world.convoy ? { phase: world.convoy.phase, hours: toHours(convoyEta(world, world.convoy)), nest: world.convoy.target.site >= 0 } : null,
      expeditions: world.expeditions.map((x) => ({
        id: x.id, soldiers: x.soldiers.length, phase: x.phase,
        hours: toHours(((x.path.length - 1 - x.seg) * x.ticks - x.acc) + (x.phase === 'out' ? (x.path.length - 1) * x.ticks : 0)),
      })),
      archives: world.research.archives,
    };
    // Карточка открытой клетки живая: прогресс стройки, снос, рост
    const open = card.value;
    if (open) card.value = describe(open);
    const m = world.mission;
    announceDown(m);
    combat.value = m ? {
      ufo: m.ufo, phase: m.phase, turn: m.turn, result: m.result, log: [...m.log],
      units: m.units.map((u) => ({
        id: u.id, name: u.name, side: u.side, hp: u.hp, maxHp: u.maxHp, ap: u.ap, personal: !!u.personal,
        ammo: u.ammo, mag: magOf(u), cover: coverAgainstNearest(m, u), adjacentCover: hasAdjacentCover(m, u),
        overwatch: u.overwatch, hunkered: u.hunkered,
      })),
      aliensSeen: m.units.filter((u) => u.side === 'alien' && view.tactical.vis[u.y * m.w + u.x]).length,
    } : null;
  }
  // Автосохранение выключено в режиме отладочного часа, чтобы не затирать сохранение
  if (debugHour === null && now - lastSave > 30000) {
    lastSave = now;
    save(true);
  }
  requestAnimationFrame(frame);
}
if (world.mission) enterMission(); // бой продолжается после перезагрузки страницы
else focusBunker();
requestAnimationFrame(frame);
