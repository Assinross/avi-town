// Граф улиц (plan.md 010, этап 2): улица - не набор клеток, а узлы (перекрёстки, повороты,
// тупики, одиночные клетки) и рёбра (цепочки прямых клеток между ними). Рисование дорог берёт
// роль клетки отсюда, а машины и люди пока работают по-старому. Порядок сторон - как в симуляции
// (DIRS): 0 - +x, 1 - -x, 2 - +y, 3 - -y; биты маски 1, 2, 4, 8.

import { DIRS, type World } from '@avi/sim';

export type NodeKind = 'end' | 'corner' | 'tee' | 'cross' | 'single';
export type Turn = 'straight' | 'left' | 'right' | 'back';

export interface StreetNode {
  cell: number;
  kind: NodeKind;
  /** Выходы узла: биты по DIRS. */
  arms: number;
  /** Индексы рёбер в graph.edges, по одному на выход. */
  edges: number[];
}

export interface StreetEdge {
  /** Клетка узла-начала. */
  a: number;
  /** Клетка узла-конца. */
  b: number;
  /** Направление от a к b: индекс DIRS. */
  dir: number;
  /** 0 - ребро вдоль x, 1 - вдоль y. */
  axis: 0 | 1;
  /** Прямые клетки ребра от a к b, без узлов. */
  cells: number[];
  /** Длина между центрами узлов в клетках. */
  length: number;
}

/** Поворот направо по DIRS: для (dx, dz) правая сторона - это (-dz, dx). */
export const RIGHT = [2, 3, 1, 0];

const bits = (m: number) => (m & 1) + ((m >> 1) & 1) + ((m >> 2) & 1) + ((m >> 3) & 1);

/** Прямая - два выхода навстречу: только вдоль x или только вдоль y. */
const isStraight = (m: number) => m === 3 || m === 12;

function kindOf(m: number): NodeKind {
  if (m === 0) return 'single';
  if (bits(m) === 1) return 'end';
  if (bits(m) === 2) return 'corner';
  if (bits(m) === 3) return 'tee';
  return 'cross';
}

export class StreetGraph {
  size = 0;
  nodes = new Map<number, StreetNode>();
  edges: StreetEdge[] = [];
  /** 1 для клетки дороги, включая неразведанную: правило рисования. */
  road = new Uint8Array(0);
  /** Клетка - узел: индекс клетки, иначе -1. */
  nodeOf = new Int32Array(0);
  /** Клетка - середина ребра: индекс ребра, иначе -1. */
  edgeOf = new Int32Array(0);
  /** Расстояние от центра узла a до центра клетки ребра. */
  along = new Float32Array(0);
  /** Связь "клетка * 4 + выход" -> индекс ребра, иначе -1. */
  private links = new Int32Array(0);

  reset() {
    this.size = 0;
    this.nodes.clear();
    this.edges = [];
    this.road = new Uint8Array(0);
    this.nodeOf = new Int32Array(0);
    this.edgeOf = new Int32Array(0);
    this.along = new Float32Array(0);
    this.links = new Int32Array(0);
  }

  build(w: World) {
    const s = w.size, n = s * s;
    this.reset();
    this.size = s;
    this.road = new Uint8Array(n);
    this.nodeOf = new Int32Array(n).fill(-1);
    this.edgeOf = new Int32Array(n).fill(-1);
    this.along = new Float32Array(n);
    this.links = new Int32Array(n * 4).fill(-1);
    for (let i = 0; i < n; i++) if (w.tiles[i].object === 'road') this.road[i] = 1;

    // Выходы каждой клетки; всё, что не прямая, - узел
    const arms = new Uint8Array(n);
    for (let y = 0; y < s; y++) {
      for (let x = 0; x < s; x++) {
        const i = y * s + x;
        if (!this.road[i]) continue;
        let m = 0;
        for (let d = 0; d < 4; d++) {
          const nx = x + DIRS[d][0], ny = y + DIRS[d][1];
          if (nx >= 0 && ny >= 0 && nx < s && ny < s && this.road[ny * s + nx]) m |= 1 << d;
        }
        arms[i] = m;
        if (isStraight(m)) continue;
        this.nodeOf[i] = i;
        this.nodes.set(i, { cell: i, kind: kindOf(m), arms: m, edges: [] });
      }
    }

    // Ребро идёт от узла по выходу через прямые клетки до следующего узла
    for (const node of this.nodes.values()) {
      for (let d = 0; d < 4; d++) {
        if (!(node.arms & (1 << d)) || this.links[node.cell * 4 + d] >= 0) continue;
        const cells: number[] = [];
        let cur = node.cell;
        let end = -1;
        for (let step = 0; step <= s; step++) {
          const x = cur % s, y = (cur / s) | 0;
          const nx = x + DIRS[d][0], ny = y + DIRS[d][1];
          if (nx < 0 || ny < 0 || nx >= s || ny >= s) break;
          const ni = ny * s + nx;
          if (this.nodes.has(ni)) {
            end = ni;
            break;
          }
          cells.push(ni);
          cur = ni;
        }
        if (end < 0) continue;
        const idx = this.edges.length;
        const edge: StreetEdge = { a: node.cell, b: end, dir: d, axis: d < 2 ? 0 : 1, cells, length: cells.length + 1 };
        this.edges.push(edge);
        node.edges.push(idx);
        this.nodes.get(end)!.edges.push(idx);
        this.links[node.cell * 4 + d] = idx;
        this.links[end * 4 + (d ^ 1)] = idx;
        for (let k = 0; k < cells.length; k++) {
          this.edgeOf[cells[k]] = idx;
          this.along[cells[k]] = k + 1;
        }
      }
    }
  }

  /** Клетка дороги, включая неразведанную. */
  isRoad(cell: number): boolean {
    return this.road[cell] === 1;
  }

  nodeAt(cell: number): StreetNode | undefined {
    return this.nodes.get(cell);
  }

  edgeAt(cell: number): StreetEdge | undefined {
    const idx = this.edgeOf[cell] ?? -1;
    return idx >= 0 ? this.edges[idx] : undefined;
  }

  /** Выходы клетки: у узла - свои, у клетки ребра - два навстречу, иначе 0. */
  arms(cell: number): number {
    const node = this.nodes.get(cell);
    if (node) return node.arms;
    const edge = this.edgeAt(cell);
    return edge ? (1 << edge.dir) | (1 << (edge.dir ^ 1)) : 0;
  }

  /** Клетки ребра от одной его клетки до другой, включая обе (порядок - от from к to). */
  cellsBetween(edge: StreetEdge, from: number, to: number): number[] {
    const pos = (cell: number) => {
      if (cell === edge.a) return 0;
      if (cell === edge.b) return edge.length;
      const k = edge.cells.indexOf(cell);
      return k < 0 ? -1 : k + 1;
    };
    const a = pos(from), b = pos(to);
    if (a < 0 || b < 0) return [];
    const step = a <= b ? 1 : -1;
    const out: number[] = [];
    for (let p = a; ; p += step) {
      out.push(p === 0 ? edge.a : p === edge.length ? edge.b : edge.cells[p - 1]);
      if (p === b) break;
    }
    return out;
  }

  /** Узлы на концах ребра, которому принадлежит клетка. */
  private edgeEnds(cell: number): number[] {
    const edge = this.edgeAt(cell);
    return edge ? [edge.a, edge.b] : [];
  }

  /** Маршрут по рёбрам между двумя дорожными клетками: рёбра и все клетки пути. */
  path(from: number, to: number): { edges: number[]; cells: number[] } | null {
    if (!this.isRoad(from) || !this.isRoad(to)) return null;
    if (from === to) return { edges: [], cells: [from] };
    const fromEdge = this.edgeOf[from] ?? -1, toEdge = this.edgeOf[to] ?? -1;
    if (fromEdge >= 0 && fromEdge === toEdge) {
      return { edges: [fromEdge], cells: this.cellsBetween(this.edges[fromEdge], from, to) };
    }
    const isNode = (cell: number) => this.nodeOf[cell] === cell;
    const starts = isNode(from)
      ? [{ node: from, prefix: [] as number[] }]
      : this.edgeEnds(from).map((node) => ({ node, prefix: this.cellsBetween(this.edges[fromEdge], from, node) }));
    const ends = isNode(to)
      ? [{ node: to, suffix: [] as number[] }]
      : this.edgeEnds(to).map((node) => ({ node, suffix: this.cellsBetween(this.edges[toEdge], node, to) }));
    let best: { edges: number[]; cells: number[] } | null = null;
    for (const start of starts) {
      for (const end of ends) {
        const edges = this.nodePath(start.node, end.node);
        if (!edges) continue;
        const cells = [...start.prefix];
        let cur = start.node;
        for (const ei of edges) {
          const edge = this.edges[ei];
          const next = edge.a === cur ? edge.b : edge.a;
          for (const cell of this.cellsBetween(edge, cur, next)) {
            if (cells[cells.length - 1] !== cell) cells.push(cell);
          }
          cur = next;
        }
        for (const cell of end.suffix) if (cells[cells.length - 1] !== cell) cells.push(cell);
        if (!best || cells.length < best.cells.length) best = { edges, cells };
      }
    }
    return best;
  }

  /** Кратчайший путь по узлам через рёбра: список индексов рёбер или null. */
  private nodePath(from: number, to: number): number[] | null {
    if (from === to) return [];
    const adj = new Map<number, { edge: number; node: number }[]>();
    const link = (a: number, edge: number, b: number) => {
      const list = adj.get(a) ?? [];
      list.push({ edge, node: b });
      adj.set(a, list);
    };
    this.edges.forEach((edge, i) => {
      link(edge.a, i, edge.b);
      link(edge.b, i, edge.a);
    });
    const prevNode = new Map<number, number>(), prevEdge = new Map<number, number>();
    const seen = new Set([from]);
    const queue = [from];
    for (let q = 0; q < queue.length && !seen.has(to); q++) {
      for (const { edge, node } of adj.get(queue[q]) ?? []) {
        if (seen.has(node)) continue;
        seen.add(node);
        prevNode.set(node, queue[q]);
        prevEdge.set(node, edge);
        queue.push(node);
      }
    }
    if (!seen.has(to)) return null;
    const edges: number[] = [];
    for (let node = to; node !== from; node = prevNode.get(node)!) edges.push(prevEdge.get(node)!);
    return edges.reverse();
  }

  /** Точка на ребре: along - от центра узла a, lateral - от оси, side 1 - правая сторона. */
  sidePoint(edge: StreetEdge, side: 1 | -1, along: number, lateral: number): { x: number; z: number } {
    const [dx, dz] = DIRS[edge.dir];
    const x = (edge.a % this.size) + 0.5 + dx * along, z = ((edge.a / this.size) | 0) + 0.5 + dz * along;
    return { x: x - dz * side * lateral, z: z + dx * side * lateral };
  }

  /** Прямо, направо, налево или назад - переход из одного выхода узла в другой. */
  turn(_node: number, fromArm: number, toArm: number): Turn {
    if (fromArm === toArm) return 'back';
    if (fromArm === (toArm ^ 1)) return 'straight';
    return toArm === RIGHT[fromArm ^ 1] ? 'right' : 'left';
  }
}

/**
 * Проверка графа: у рёбер узлы на концах, у узлов число рёбер равно числу выходов,
 * каждая дорожная клетка ровно в одном узле или ребре. Пустой массив - всё верно.
 */
export function checkStreets(w: World, graph: StreetGraph): string[] {
  const errors: string[] = [];
  const s = w.size, n = s * s;
  const cellName = (i: number) => `(${i % s},${(i / s) | 0})`;
  for (let idx = 0; idx < graph.edges.length; idx++) {
    const e = graph.edges[idx];
    if (!graph.nodes.has(e.a)) errors.push(`ребро ${idx}: начало ${cellName(e.a)} не узел`);
    if (!graph.nodes.has(e.b)) errors.push(`ребро ${idx}: конец ${cellName(e.b)} не узел`);
    if (!graph.nodes.get(e.a)?.edges.includes(idx)) errors.push(`ребро ${idx}: не записано у начала`);
    if (!graph.nodes.get(e.b)?.edges.includes(idx)) errors.push(`ребро ${idx}: не записано у конца`);
    if (e.length !== e.cells.length + 1) errors.push(`ребро ${idx}: длина ${e.length} не равна ${e.cells.length + 1}`);
    let prev = e.a;
    for (const cell of e.cells) {
      const dx = cell % s - (prev % s), dy = ((cell / s) | 0) - ((prev / s) | 0);
      if (dx !== DIRS[e.dir][0] || dy !== DIRS[e.dir][1]) errors.push(`ребро ${idx}: клетка ${cellName(cell)} ломает направление`);
      if (graph.edgeOf[cell] !== idx) errors.push(`ребро ${idx}: клетка ${cellName(cell)} не помечена ребром`);
      prev = cell;
    }
    if (!graph.isRoad(e.a) || !graph.isRoad(e.b)) errors.push(`ребро ${idx}: узел не на дороге`);
  }
  for (const node of graph.nodes.values()) {
    if (node.edges.length !== bits(node.arms)) {
      errors.push(`узел ${cellName(node.cell)} (${node.kind}): рёбер ${node.edges.length}, выходов ${bits(node.arms)}`);
    }
  }
  for (let i = 0; i < n; i++) {
    const roadTile = w.tiles[i].object === 'road';
    if (roadTile !== graph.isRoad(i)) {
      errors.push(`клетка ${cellName(i)}: на карте ${roadTile ? 'дорога' : 'не дорога'}, в графе ${graph.isRoad(i) ? 'дорога' : 'нет'}`);
      continue;
    }
    if (!roadTile) continue;
    const inNode = graph.nodeOf[i] === i ? 1 : 0;
    const inEdge = graph.edgeOf[i] >= 0 ? 1 : 0;
    if (inNode + inEdge !== 1) errors.push(`клетка ${cellName(i)}: узлов ${inNode}, рёбер ${inEdge}`);
  }
  return errors;
}
