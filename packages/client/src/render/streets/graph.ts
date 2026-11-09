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

/** Поворот направо/налево по DIRS: для (dx, dz) правая сторона - это (-dz, dx). */
export const RIGHT = [2, 3, 1, 0];
export const LEFT = [3, 2, 0, 1];

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

  /** Прямо, направо, налево или назад - переход из одного выхода узла в другой. */
  turn(_node: number, fromArm: number, toArm: number): Turn {
    if (fromArm === toArm) return 'straight';
    if (fromArm === (toArm ^ 1)) return 'back';
    return toArm === RIGHT[fromArm] ? 'right' : 'left';
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
