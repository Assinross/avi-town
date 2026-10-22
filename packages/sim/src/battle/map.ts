// Поле боя: построение из клеток города, высадка, укрытия-пропсы.

import { ALIEN_BY_ID, BATTLE, COVER_BY_ID, COVERS, SQUAD, UFO_BY_ID, type CoverDef } from '@avi/data';
import { nextInt } from '../rng';
import { armoryBonus, PERSONAL_ID, readySoldiers } from '../squad';
import { tileAt, type Soldier, type World } from '../world';
import {
  AREA_RADIUS, CELLS,
  type CellKind, type CoverProp, type Mission, type MissionTarget, type TacResult,
} from './types';
import { contact, scamper, startXcomTurn } from './turn';

export const cellAt = (m: Mission, x: number, y: number): CellKind => (x < 0 || y < 0 || x >= m.w || y >= m.h ? 2 : m.cells[y * m.w + x]);

// --- Построение поля из клеток города --------------------------------------------------------

function fillTile(w: World, m: Mission, tx: number, ty: number) {
  const t = tileAt(w, tx, ty);
  const bx = (tx - Math.floor(m.ox / CELLS)) * CELLS, by = (ty - Math.floor(m.oy / CELLS)) * CELLS;
  const set = (cx: number, cy: number, k: CellKind) => {
    const x = bx + cx, y = by + cy;
    if (x >= 0 && y >= 0 && x < m.w && y < m.h) m.cells[y * m.w + x] = Math.max(m.cells[y * m.w + x], k) as CellKind;
  };
  const rect = (x0: number, y0: number, x1: number, y1: number, k: CellKind) => {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) set(x, y, k);
  };
  if (!t) return rect(0, 0, 3, 3, 2);
  const v = t.variant;
  if (t.terrain === 'water') return rect(0, 0, 3, 3, 1);
  switch (t.object) {
    case 'ruin': return rect(0, 0, 2, 2, 2);
    case 'building': return rect(0, 0, 3, 3, 2);
    case 'crash': return rect(0, 0, 3, 3, 2);
    case 'tree': return set(1 + (v & 1), 1 + ((v >> 1) & 1), 1);
    case 'rubble': set(v & 3, (v >> 2) & 3, 1); set((v >> 4) & 3, (v >> 6) & 3, 1); return;
    case 'road':
      // Машины на дороге теперь укрытия-пропсы (placeProps), клетка дороги остаётся свободной.
      return;
    case 'zone':
      if (t.level === 0) return;
      if (t.zone === 'A') return set(3, 0, 1);
      if (t.level === 1) { rect(1, 1, 2, 2, 2); set(0, 3, 1); return; }
      return rect(0, 0, 2, 2, 2);
    default:
      if (t.terrain === 'rock' && (v & 3) === 0) set(2, 2, 1);
  }
}

function freeCells(m: Mission): number[] {
  const out: number[] = [];
  m.cells.forEach((c, i) => { if (c === 0) out.push(i); });
  return out;
}

// --- Укрытия-пропсы --------------------------------------------------------------------------

/** Взвешенный выбор укрытия по CoverDef.weight. */
function pickCover(w: World, total: number): CoverDef {
  let r = nextInt(w.rng, total);
  for (const c of COVERS) {
    if (r < c.weight) return c;
    r -= c.weight;
  }
  return COVERS[COVERS.length - 1];
}

/**
 * Расставляет укрытия-пропсы детерминированно: свободные клетки поля вне высадки и вне
 * радиуса propClearRadius от живых юнитов, без повторов, не больше BATTLE.propCount.
 */
function placeProps(w: World, m: Mission, deploy: number[]) {
  const deployCells = new Set(deploy);
  const unitCells = m.units.filter((u) => u.hp > 0).map((u) => u.y * m.w + u.x);
  const candidates: number[] = [];
  for (let i = 0; i < m.cells.length; i++) {
    if (m.cells[i] !== 0 || deployCells.has(i) || unitCells.includes(i)) continue;
    const x = i % m.w, y = Math.floor(i / m.w);
    const nearUnit = unitCells.some((c) => Math.max(Math.abs((c % m.w) - x), Math.abs(Math.floor(c / m.w) - y)) <= BATTLE.propClearRadius);
    if (!nearUnit) candidates.push(i);
  }
  const total = COVERS.reduce((sum, c) => sum + c.weight, 0);
  if (!COVERS.length || total <= 0) return;
  const count = Math.min(BATTLE.propCount, candidates.length);
  for (let k = 0; k < count; k++) {
    const pick = k + nextInt(w.rng, candidates.length - k);
    const swap = candidates[k];
    candidates[k] = candidates[pick];
    candidates[pick] = swap;
    const def = pickCover(w, total);
    m.props.push({ id: k + 1, cell: candidates[k], kind: def.id, hp: def.hp, maxHp: def.hp, state: 'whole' });
  }
}

export function propAt(m: Mission, x: number, y: number): CoverProp | undefined {
  if (x < 0 || y < 0 || x >= m.w || y >= m.h) return undefined;
  const cell = y * m.w + x;
  return m.props.find((p) => p.cell === cell);
}

/** Пропс перекрывает клетку, пока не разрушен и задан твёрдым в данных. */
export function solidPropAt(m: Mission, x: number, y: number): boolean {
  const p = propAt(m, x, y);
  return !!p && p.state !== 'collapsed' && COVER_BY_ID[p.kind]?.solid === true;
}

// --- Старт миссии ----------------------------------------------------------------------------

/**
 * Начать бой. По умолчанию - на месте крушения; target - другое место (гнездо), from - клетка,
 * откуда подъехал броневик (с той стороны и высадка), team - кто приехал.
 */
export function startMission(w: World, target?: MissionTarget, from?: { x: number; y: number }, team?: Soldier[]): TacResult {
  const c = target ?? (w.crash ? { x: w.crash.x, y: w.crash.y, ufo: w.crash.ufo } : null);
  if (!c) return { ok: false, reason: 'no_mission' };
  const tx0 = c.x - AREA_RADIUS, ty0 = c.y - AREA_RADIUS;
  const size = (AREA_RADIUS * 2 + 1) * CELLS;
  const m: Mission = {
    ufo: c.ufo, ox: tx0 * CELLS, oy: ty0 * CELLS, w: size, h: size, cells: new Array(size * size).fill(0),
    units: [], props: [], phase: 'explore', turn: 1, result: null, log: [],
  };
  if (target?.site !== undefined) m.site = target.site;
  for (let ty = ty0; ty <= c.y + AREA_RADIUS; ty++) for (let tx = tx0; tx <= c.x + AREA_RADIUS; tx++) fillTile(w, m, tx, ty);

  // Отряд высаживается с той стороны поля, откуда приехал броневик; без броневика - ближе к центру карты
  const center = (AREA_RADIUS * CELLS) + CELLS / 2;
  const fromLeft = from ? from.x < c.x || (from.x === c.x && c.x > w.size / 2) : c.x > w.size / 2;
  const fromTop = from ? from.y < c.y || (from.y === c.y && c.y > w.size / 2) : c.y > w.size / 2;
  const free = freeCells(m);
  const edgeScore = (i: number) => {
    const x = i % m.w, y = Math.floor(i / m.w);
    return (fromLeft ? x : m.w - 1 - x) + (fromTop ? y : m.h - 1 - y);
  };
  const deploy = [...free].sort((a, b) => edgeScore(a) - edgeScore(b) || a - b);
  let id = 1;
  const s = SQUAD.soldier;
  // На миссию идут только здоровые бойцы из состава, не больше штатного размера отряда
  const squad = (team ?? readySoldiers(w)).slice(0, Math.min(SQUAD.size, deploy.length));
  // Оружейная бункера: бойцы метче и бьют сильнее
  const arm = armoryBonus(w);
  squad.forEach((sol, k) => {
    const i = deploy[k];
    const personal = sol.id === PERSONAL_ID;
    m.units.push({
      id: id++, side: 'xcom', kind: 'soldier', name: personal ? `${sol.name} (вы)` : sol.name, x: i % m.w, y: Math.floor(i / m.w),
      hp: s.hp, maxHp: s.hp, aim: s.aim + arm.aim, mobility: s.mobility, damage: [s.damage[0] + arm.damage, s.damage[1] + arm.damage], ap: 2, path: [], moveAcc: 0,
      personal, soldier: sol.id, ammo: s.mag, overwatch: false, hunkered: false,
    });
  });
  // Экипаж - вокруг тарелки, на свободных клетках ближе всего к центру поля
  const near = [...free].sort((a, b) => {
    const da = Math.abs((a % m.w) - center) + Math.abs(Math.floor(a / m.w) - center);
    const db = Math.abs((b % m.w) - center) + Math.abs(Math.floor(b / m.w) - center);
    return da - db || a - b;
  });
  const taken = new Set(deploy.slice(0, SQUAD.size));
  let slot = 0;
  for (const alienId of UFO_BY_ID[c.ufo]?.crew ?? ['Sectoid']) {
    const def = ALIEN_BY_ID[alienId];
    while (slot < near.length && taken.has(near[slot])) slot++;
    const i = near[Math.min(slot + nextInt(w.rng, 3), near.length - 1)];
    taken.add(i);
    slot += 2;
    m.units.push({
      id: id++, side: 'alien', kind: def.id, name: def.nameKey, x: i % m.w, y: Math.floor(i / m.w),
      hp: def.hp, maxHp: def.hp, aim: def.aim, mobility: def.mobility, damage: [...def.damage] as [number, number], ap: 2, path: [], moveAcc: 0,
      ammo: def.mag, overwatch: false, hunkered: false,
    });
  }
  placeProps(w, m, deploy.slice(0, SQUAD.size));
  m.log.push('Отряд на месте. Пришельцы не замечены - осторожно продвигайтесь');
  if (contact(m)) {
    m.phase = 'turn';
    scamper(w, m);
    startXcomTurn(m);
    m.log.push('Пришельцы уже на виду и бросились в укрытия - пошаговый бой. Ход 1');
  }
  w.mission = m;
  w.speed = 0;
  w.revision++;
  return { ok: true };
}
