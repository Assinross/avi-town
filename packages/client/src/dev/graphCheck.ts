// Отладочная проверка графа улиц (только dev): ручные формы на маленькой карте плюс проверка
// живого города. Вызывается из консоли: avi.checkGraphShapes() и avi.checkStreets().

import { applyCommand, createWorld, tileAt, type World } from '@avi/sim';
import { checkStreets, StreetGraph } from '../render/streets/graph';

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
  ];
}
