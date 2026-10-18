import { effect } from '@preact/signals';
import { render } from 'preact';
import * as THREE from 'three';
import { BUILDING_BY_ID, t as tr, techName, UFO_BY_ID } from '@avi/data';
import {
  applyCommand, applyTactical, CAPACITY, canSee, canZone, checkBuilding, coverOf, createWorld, deserialize, hasRoadNear, History, hitChance,
  moveCost, serialize, SPEED_FACTOR, step, tacticalTick, TICK_HZ, tileAt,
  type Command, type GameEvent, type Mission, type ReasonCode, type TacCommand, type World, type ZoneType,
} from '@avi/sim';
import { CameraRig } from './input/cameraRig';
import { SceneView } from './render/sceneView';
import { Hud } from './ui/Hud';
import { canUndo, card, combat, flash, hoverInfo, hud, overlay, raiseAlert, researchOpen, selectedUnit, tool, type Tool } from './ui/store';

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
  unknown: 'Неизвестное действие',
};
const TERRAIN: Record<string, string> = {
  wasteland: 'Пустошь', soil: 'Плодородная земля', contaminated: 'Заражённая земля', water: 'Вода', rock: 'Камни',
};
const OBJECT: Record<string, string> = {
  none: '', road: 'дорога', ruin: 'руины', tree: 'дерево', rubble: 'завал', zone: '', building: '', crash: 'сбитое НЛО',
};
const ZONE_NAME: Record<ZoneType, string> = { R: 'Жильё', C: 'Торговля', I: 'Промзона', A: 'Ферма' };
const ZONE_TOOLS: Partial<Record<Tool, ZoneType>> = { zoneR: 'R', zoneC: 'C', zoneI: 'I', zoneA: 'A' };
const buildDef = (t: Tool) => (t.startsWith('b:') ? t.slice(2) : null);
const objectName = (t: { object: string; def: string | null }) =>
  t.object === 'building' && t.def ? tr(BUILDING_BY_ID[t.def]?.nameKey ?? t.def) : OBJECT[t.object];

// --- Мир: загрузка сохранения или новая игра ------------------------------------------------
const params = new URLSearchParams(location.search);
function loadOrCreate(): World {
  if (!params.get('seed')) {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (raw) {
        const res = deserialize(raw);
        if (res.ok) return res.world;
      }
    } catch { /* хранилище недоступно - новая игра */ }
  }
  return createWorld(Number(params.get('seed')) || 2026, 64);
}
let world = loadOrCreate();
let history = new History();

function save(silent = false) {
  try {
    localStorage.setItem(SAVE_KEY, serialize(world));
    if (!silent) flash('Игра сохранена');
  } catch {
    if (!silent) flash('Не удалось сохранить: хранилище браузера недоступно');
  }
}

const canvas = document.getElementById('scene') as HTMLCanvasElement;
const view = new SceneView(canvas, world, document.getElementById('labels')!);
const rig = new CameraRig(world.size);

function newGame() {
  if (!confirm('Начать новый город? Текущий будет потерян.')) return;
  world = createWorld((Date.now() & 0x7fffffff) >>> 0, 64);
  history = new History();
  canUndo.value = false;
  view.setWorld(world);
  card.value = null;
  save(true);
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
    research: (tech) => {
      const res = run({ type: 'startResearch', tech });
      if (res.ok) flash(`Учёные взялись за "${techName(tech)}"`);
    },
    assault: () => {
      if (run({ type: 'assaultCrash' }).ok) enterMission();
    },
    endTurn: () => tac({ type: 'tacEndTurn' }),
    retreat: () => tac({ type: 'tacRetreat' }),
    finishMission: () => {
      tac({ type: 'tacFinish' });
      rig.zoomBy(2.2 / rig.camera.zoom);
    },
    selectUnit,
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
};

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
  rig.target.set(world.crash.x + 0.5, 0, world.crash.y + 0.5);
  rig.zoomBy(7 / rig.camera.zoom);
  const first = m.units.find((u) => u.side === 'xcom');
  if (first) selectUnit(first.id);
}

function tacCell(e: { clientX: number; clientY: number }, m: Mission) {
  const ndc = new THREE.Vector2((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
  raycaster.setFromCamera(ndc, rig.camera);
  if (!raycaster.ray.intersectPlane(ground, hit)) return null;
  return view.tactical.cellAt(m, hit.x, hit.z);
}

function tacClick(e: PointerEvent, m: Mission) {
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

function tacHover(e: PointerEvent, m: Mission) {
  const c = tacCell(e, m);
  if (!c) return (hoverInfo.value = '');
  const sel = m.units.find((u) => u.id === selectedUnit.value && u.hp > 0);
  const at = m.units.find((u) => u.hp > 0 && u.x === c.x && u.y === c.y);
  if (at?.side === 'alien' && view.tactical.vis[at.y * m.w + at.x]) {
    const name = tr(at.name);
    if (!sel) return (hoverInfo.value = name);
    const cover = coverOf(m, at, sel);
    hoverInfo.value = canSee(m, sel, at)
      ? `${name}: шанс попадания ${hitChance(m, sel, at)}% · ${cover === 40 ? 'полное укрытие' : cover === 20 ? 'половинное укрытие' : 'без укрытия - фланг!'}`
      : `${name}: не на линии огня`;
    return;
  }
  if (sel && m.phase === 'turn') {
    const cost = moveCost(m, sel, c.x, c.y);
    hoverInfo.value = cost < 0 ? 'Туда не пройти' : cost === 1 ? 'Ход: 1 очко' : 'Рывок: 2 очка';
  } else hoverInfo.value = '';
}

let dragStart: Cell | null = null;
let lastRoad: Cell | null = null;
let panning = false;
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

function updatePreview(cur: Cell | null) {
  const t = tool.value;
  if (!cur) return view.setPreview([]);
  if (dragStart && isRectTool(t)) {
    const zone = ZONE_TOOLS[t];
    view.setPreview(rectCells(dragStart, cur).map((c) => {
      const tile = tileAt(world, c.x, c.y)!;
      return { ...c, ok: zone ? canZone(tile, zone) : tile.object !== 'none' };
    }));
    return;
  }
  const def = buildDef(t);
  if (def) {
    const ok = checkBuilding(world, def, cur.x, cur.y).ok;
    const size = BUILDING_BY_ID[def]?.size ?? 1;
    const cells: (Cell & { ok: boolean })[] = [];
    for (let dy = 0; dy < size; dy++) for (let dx = 0; dx < size; dx++) cells.push({ x: cur.x + dx, y: cur.y + dy, ok });
    view.setPreview(cells);
    return;
  }
  const tile = tileAt(world, cur.x, cur.y)!;
  const ok = t === 'road' ? tile.terrain !== 'water' && ['none', 'tree', 'rubble', 'road'].includes(tile.object) : true;
  view.setPreview([{ ...cur, ok }]);
}

function describe(c: Cell) {
  const t = tileAt(world, c.x, c.y)!;
  const lines = [`${TERRAIN[t.terrain]} · [${c.x}, ${c.y}]`];
  let title = objectName(t) || TERRAIN[t.terrain];
  if (t.object === 'zone' && t.zone) {
    title = `${ZONE_NAME[t.zone]}${t.level ? ` · уровень ${t.level}` : ' · пустой участок'}`;
    const cap = CAPACITY[t.zone][t.level];
    if (t.level) lines.push(t.zone === 'R' ? `Жителей: ${cap}` : `Рабочих мест: ${cap}`);
    lines.push(`Ток: ${t.powered ? 'есть' : 'нет'} · Вода: ${t.watered ? 'есть' : 'нет'}`);
    const why: string[] = [];
    if (!hasRoadNear(world, c.x, c.y, 2)) why.push('нет дороги ближе 2 клеток');
    if (t.zone !== 'A' && !t.powered) why.push('нет тока - поставь генератор у дороги');
    if (!t.watered) why.push('без воды выше 1 уровня не вырастет');
    if (world.stats.demand[t.zone] <= 0) why.push('нет спроса на этот тип зоны');
    if (t.terrain === 'contaminated' && t.zone !== 'I') why.push('заражённая земля - максимум 1 уровень');
    if (why.length) lines.push('Мешает: ' + why.join('; '));
  } else if (t.object === 'building' && t.def) {
    const def = BUILDING_BY_ID[t.def];
    lines.push(`Прочность: ${t.hp}/${def.hp}${t.hp < def.hp ? ' - мастерская починит' : ''}`);
    if (def.needsPower) lines.push(`Ток: ${t.powered ? 'есть' : 'нет - подведи дорогу от генератора'}`);
    if (def.power) lines.push(`Даёт ${def.power} ед. тока в сеть дорог`);
    if (def.water) lines.push(`Даёт воду: у реки ${def.water.river}, колодец ${def.water.well}`);
    if (def.research) lines.push(`Исследования: +${def.research} очк./день`);
    if (def.metalPerDay) lines.push(`Металл: +${def.metalPerDay}/день`);
    if (def.radar) lines.push('Замечает НЛО при появлении и ставит игру на паузу');
    if (def.aa) lines.push(`Радиус ${def.aa.range} кл. · урон ${def.aa.damage} · точность ${def.aa.accuracy}%`);
    lines.push(`Содержание: ${def.upkeep} ¢/день`);
  } else {
    title = title.charAt(0).toUpperCase() + title.slice(1);
    if (t.object === 'ruin' || t.object === 'rubble') lines.push('Снеси, чтобы освободить место');
    if (t.object === 'crash') lines.push('Отправь отряд, пока пришельцы не ушли');
  }
  return { title, lines };
}

canvas.addEventListener('contextmenu', (e) => e.preventDefault());
canvas.addEventListener('pointerdown', (e) => {
  canvas.setPointerCapture(e.pointerId);
  last = { x: e.clientX, y: e.clientY };
  if (e.button === 1 || e.button === 2 || (e.button === 0 && spaceHeld)) {
    panning = true;
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
  } else if (t === 'road') {
    lastRoad = c;
    history.beginGroup(world);
    run({ type: 'buildRoad', ...c });
  } else if (isRectTool(t)) {
    dragStart = c;
  } else if (buildDef(t)) {
    run({ type: 'placeBuilding', def: buildDef(t)!, ...c });
  }
  updatePreview(c);
});

canvas.addEventListener('pointermove', (e) => {
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
  if (c) {
    const tile = tileAt(world, c.x, c.y)!;
    const obj = tile.object === 'zone' && tile.zone ? `${ZONE_NAME[tile.zone]}${tile.level ? ' ур. ' + tile.level : ''}` : objectName(tile);
    hoverInfo.value = `${TERRAIN[tile.terrain]}${obj ? ' · ' + obj : ''}`;
  } else hoverInfo.value = '';
  if (lastRoad && c && (c.x !== lastRoad.x || c.y !== lastRoad.y)) {
    for (const s of tileLine(lastRoad, c)) run({ type: 'buildRoad', ...s }, true);
    lastRoad = c;
  }
});

canvas.addEventListener('pointerup', (e) => {
  if (panning) {
    panning = false;
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
  if (lastRoad) {
    history.endGroup();
    canUndo.value = history.canUndo;
  }
  dragStart = null;
  lastRoad = null;
  updatePreview(c);
});

canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  rig.zoomBy(e.deltaY < 0 ? 1.15 : 1 / 1.15);
}, { passive: false });

const keys = new Set<string>();
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
  }
  if (e.code === 'KeyQ') rig.rotate(-1);
  if (e.code === 'KeyE') rig.rotate(1);
  if (e.code === 'Digit1' || e.code === 'Digit2' || e.code === 'Digit3') setSpeed(Number(e.code.slice(-1)));
  if (e.code === 'KeyR') tool.value = 'road';
  if (e.code === 'KeyB') tool.value = 'bulldoze';
  if (e.code === 'KeyI' || e.code === 'Escape') {
    tool.value = 'inspect';
    dragStart = null;
    researchOpen.value = false;
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
      return raiseAlert(`Место крушения зачищено. Трофеи: ${s.money ?? 0} ¢, сплавы ${s.alloys ?? 0}, элерий ${s.elerium ?? 0}, фрагменты ${s.fragments ?? 0}${e.lost ? `. Погибло бойцов: ${e.lost}` : ''}`);
    }
    case 'missionFailed':
      return raiseAlert(e.retreat ? 'Отряд отступил. Пришельцы остались у тарелки' : `Отряд погиб (${e.lost}). Пришельцы остались у тарелки`);
  }
}

// --- Цикл: симуляция по реальному времени, отрисовка, автосохранение -------------------------
let prev = performance.now();
let tickAcc = 0;
let tacAcc = 0;
let hudRevision = -1;
let lastSave = performance.now();
window.addEventListener('beforeunload', () => save(true));

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
    if (world.events.some((e) => e.type !== 'researchDone')) {
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
  if (hudRevision !== world.revision) {
    hudRevision = world.revision;
    const u = world.raid?.ufo;
    hud.value = {
      money: world.money, food: world.food, day: world.day, speed: world.speed, hungerDays: world.hungerDays,
      stats: { ...world.stats, demand: { ...world.stats.demand } },
      resources: { ...world.resources },
      research: { ...world.research, done: [...world.research.done] },
      raid: u && world.raid ? { ufo: u.def, hp: u.hp, maxHp: u.maxHp, phase: u.phase, detected: world.raid.detected } : null,
      crash: world.crash ? { ...world.crash } : null,
      nextRaidDay: world.nextRaidDay,
    };
    const m = world.mission;
    combat.value = m ? {
      ufo: m.ufo, phase: m.phase, turn: m.turn, result: m.result, log: [...m.log],
      units: m.units.map((u) => ({ id: u.id, name: u.name, side: u.side, hp: u.hp, maxHp: u.maxHp, ap: u.ap, personal: !!u.personal })),
      aliensSeen: m.units.filter((u) => u.side === 'alien' && view.tactical.vis[u.y * m.w + u.x]).length,
    } : null;
  }
  if (now - lastSave > 30000) {
    lastSave = now;
    save(true);
  }
  requestAnimationFrame(frame);
}
if (world.mission) enterMission(); // бой продолжается после перезагрузки страницы
requestAnimationFrame(frame);
