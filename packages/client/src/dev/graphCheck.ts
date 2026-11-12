// Отладочная проверка графа улиц (только dev): ручные формы на маленькой карте плюс проверка
// живого города. Вызывается из консоли: avi.checkGraphShapes() и avi.checkStreets().

import { applyCommand, createWorld, tileAt, type World } from '@avi/sim';
import { checkStreets, StreetGraph } from '../render/streets/graph';
import { checkLanes, LaneGraph } from '../render/laneGraph';

/** Чистая карта 16x16: ровная земля без деревьев, камней и воды. */
function blankWorld(): World {
  const w = createWorld(1, 16);
  w.money = 900000;
  w.tiles.forEach((t) => Object.assign(t, { terrain: 'soil', object: 'none' }));
  return w;
}

interface ShapeExpect {
  nodes: number;
  edges: number;
  lengths?: number[];
}

/** Одна форма: дороги строятся командами, затем проверяется граф и ожидаемые числа. */
function shape(name: string, roads: [number, number][], expect: ShapeExpect): string[] {
  const w = blankWorld();
  for (const [x, y] of roads) {
    const res = applyCommand(w, { type: 'buildRoad', x, y });
    if (!res.ok) return [`${name}: дорога (${x},${y}) не построилась`];
  }
  // Проверяем именно граф, а не то, что осталось на карте
  const graph = new StreetGraph();
  graph.build(w);
  const errors = checkStreets(w, graph).map((e) => `${name}: ${e}`);
  if (graph.nodes.size !== expect.nodes) errors.push(`${name}: узлов ${graph.nodes.size}, ждали ${expect.nodes}`);
  if (graph.edges.length !== expect.edges) errors.push(`${name}: рёбер ${graph.edges.length}, ждали ${expect.edges}`);
  if (expect.lengths) {
    const lengths = graph.edges.map((e) => e.length).sort((a, b) => a - b);
    if (lengths.join(',') !== expect.lengths.join(',')) errors.push(`${name}: длины рёбер ${lengths.join(',')}, ждали ${expect.lengths.join(',')}`);
  }
  return errors;
}

/**
 * Проверка графа на всех формах улиц: линия с тупиками, поворот, Т, крест,
 * кольцо из поворотов и одиночная клетка. Пустой массив - всё верно.
 */
export function checkGraphShapes(): string[] {
  const line: [number, number][] = [[2, 2], [3, 2], [4, 2], [5, 2], [6, 2]];
  const corner: [number, number][] = [[2, 4], [3, 4], [3, 5], [3, 6]];
  const tee: [number, number][] = [[2, 8], [3, 8], [4, 8], [3, 7]];
  const cross: [number, number][] = [[7, 8], [8, 8], [9, 8], [8, 7], [8, 9]];
  const ring: [number, number][] = [[11, 2], [12, 2], [12, 3], [11, 3]];
  const single: [number, number][] = [[10, 10]];
  return [
    ...shape('линия', line, { nodes: 2, edges: 1, lengths: [4] }),
    ...shape('поворот', corner, { nodes: 3, edges: 2, lengths: [1, 2] }),
    ...shape('Т', tee, { nodes: 4, edges: 3, lengths: [1, 1, 1] }),
    ...shape('крест', cross, { nodes: 5, edges: 4, lengths: [1, 1, 1, 1] }),
    ...shape('кольцо', ring, { nodes: 4, edges: 4, lengths: [1, 1, 1, 1] }),
    ...shape('одиночная клетка', single, { nodes: 1, edges: 0 }),
    ...apiChecks(),
  ];
}

/** Проверка запросов: маршрут рёбрами. */
function apiChecks(): string[] {
  const errors: string[] = [];
  const idx = (x: number, y: number) => y * 16 + x;
  const w = blankWorld();
  for (const [x, y] of [[2, 2], [3, 2], [4, 2], [5, 2], [6, 2]] as [number, number][]) applyCommand(w, { type: 'buildRoad', x, y });
  const g = new StreetGraph();
  g.build(w);
  const p = g.path(idx(2, 2), idx(6, 2));
  if (!p || p.edges.length !== 1 || p.cells.length !== 5) errors.push('path по линии: не одно ребро из 5 клеток');
  for (const [x, y] of [[6, 3], [6, 4]] as [number, number][]) applyCommand(w, { type: 'buildRoad', x, y });
  const gb = new StreetGraph();
  gb.build(w);
  const q = gb.path(idx(3, 2), idx(6, 3));
  if (!q || q.edges.join(',') !== '0,1') errors.push('path от середины ребра: не оба ребра');
  const w2 = blankWorld();
  for (const [x, y] of [[2, 4], [3, 4], [3, 5], [3, 6]] as [number, number][]) applyCommand(w2, { type: 'buildRoad', x, y });
  const g2 = new StreetGraph();
  g2.build(w2);
  const c = g2.path(idx(2, 4), idx(3, 6));
  if (!c || c.edges.length !== 2 || c.cells.length !== 4) errors.push('path по повороту: не два ребра из 4 клеток');
  const w3 = blankWorld();
  for (const [x, y] of [[2, 8], [3, 8], [4, 8], [3, 7]] as [number, number][]) applyCommand(w3, { type: 'buildRoad', x, y });
  const g3 = new StreetGraph();
  g3.build(w3);
  const node = idx(3, 8);
  if (g3.turn(node, 1, 0) !== 'straight') errors.push('turn: продолжение не прямо');
  if (g3.turn(node, 1, 3) !== 'left') errors.push('turn: поворот не налево');
  const edge = g.edges.find((e) => e.dir === 0);
  const point = edge ? g.sidePoint(edge, 1, 1, 0.1) : null;
  if (!point || point.z <= 2.5) errors.push('sidePoint: правая сторона не в +z');
  return errors;
}

/** Проверка графа полос на формах (только dev): avi.checkLaneShapes(). */
export function checkLaneShapes(): string[] {
  const errors: string[] = [];
  const idx = (x: number, y: number) => y * 16 + x;
  const w = blankWorld();
  // Проспект вдоль x парами (x,4)-(x,5), улица поперёк по x = 6
  for (let x = 2; x <= 8; x++) applyCommand(w, { type: 'buildRoad', x, y: 4, pair: { x, y: 5 }, avenue: true });
  for (let y = 2; y <= 8; y++) applyCommand(w, { type: 'buildRoad', x: 6, y });
  const streets = new StreetGraph();
  streets.build(w);
  const lanes = new LaneGraph();
  lanes.build(w, streets);
  errors.push(...checkLanes(w, lanes).slice(0, 8));
  if (errors.length) errors.push(`рёбра: ${streets.edges.map((e) => `${e.a % 16},${(e.a / 16) | 0}->${e.b % 16},${(e.b / 16) | 0}[${e.cells.length}]`).join(' ')}`);
  errors.push(...laneShapeChecks(lanes, idx));
  errors.push(...laneRouteChecks(lanes, idx));
  return errors;
}

type Idx = (x: number, y: number) => number;

/** Полосы на клетках: у проспекта две (0.05 и 0.35), у улицы одна (0.13). */
function laneShapeChecks(lanes: LaneGraph, idx: Idx): string[] {
  const errors: string[] = [];
  const check = (x: number, y: number, dir: number, offsets: number[]) => {
    const found = lanes.lanesAt(idx(x, y)).filter((l) => l.dir === dir)
      .map((l) => l.offset).sort((a, b) => a - b);
    if (found.join(',') !== offsets.join(',')) {
      errors.push(`полосы (${x},${y}) по ${dir}: ${found.join(',') || 'нет'}, ждали ${offsets.join(',')}`);
    }
  };
  check(4, 4, 1, [-0.35, -0.05]);
  check(4, 5, 0, [-0.35, -0.05]);
  check(6, 7, 2, [0.13]);
  if (errors.length) errors.push(`полосы: ${lanes.lanes.map((l) => `${l.from % 16},${(l.from / 16) | 0}->${l.to % 16},${(l.to / 16) | 0} d${l.dir} o${l.offset}`).join(' ')}`);
  return errors;
}

/** Маршруты по форме: прямо по проспекту и налево с перестроением в левую полосу. */
function laneRouteChecks(lanes: LaneGraph, idx: Idx): string[] {
  const errors: string[] = [];
  const straight = lanes.route(idx(2, 5), idx(8, 5));
  if (!straight) errors.push('маршрут вдоль проспекта не найден');
  else {
    const plan = lanes.plan(straight, idx(2, 5), idx(8, 5));
    if (!plan) errors.push('план вдоль проспекта не собрался');
    else {
      if (plan.path[0] !== idx(2, 5) || plan.path[plan.path.length - 1] !== idx(8, 5)) errors.push('план вдоль проспекта не от выезда до цели');
      if (plan.offsets.some((o) => o !== -0.05)) errors.push(`смещения прямой поездки: ${plan.offsets.join(',')}`);
    }
  }
  const left = lanes.route(idx(2, 5), idx(6, 2));
  if (!left) errors.push('маршрут налево не найден');
  else {
    const turns = left.maneuvers.map((id) => lanes.maneuvers[id]);
    if (!turns.some((m) => m.turn === 'lane')) errors.push(`налево: нет перестроения в левую полосу (${turns.map((m) => m.turn).join(',')}; полосы ${left.lanes.map((id) => lanes.lanes[id].offset).join(',')})`);
    if (!turns.some((m) => m.turn === 'left')) errors.push('налево: нет левого поворота');
    const plan = lanes.plan(left, idx(2, 5), idx(6, 2));
    if (!plan) errors.push('план налево не собрался');
    else {
      if (!plan.offsets.includes(-0.35)) errors.push('налево: не был в левой полосе');
      if (!plan.changes.length) errors.push('налево: нет места перестроения');
    }
  }
  return errors;
}
