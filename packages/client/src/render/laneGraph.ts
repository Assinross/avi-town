// Граф полос (plan.md 011, этап 2): дорога - не только клетки, но и полосы по направлениям
// (улица - одна, проспект - две) и манёвры на узлах "полоса входа -> полоса выхода"
// (прямо, направо, налево, разворот). Ещё одно ребро графа - перестроение между полосами
// одного ребра на прямой. Машина прокладывает путь по манёврам (traffic.ts), а геометрию
// движения собирает lanes.ts по профилю смещений: у улицы 0.13, у проспекта -0.05 (у внешнего
// тротуара) и -0.35 (у осевой). Направление езды в клетке проспекта задаёт сторона ленты:
// машина едет так, что внешний тротуар у неё справа (bandOf в streets/graph.ts).

import { DIRS, type World } from '@avi/sim';
import { AVENUE_LANES, STREET_LANE, turnArc } from './lanes';
import type { StreetGraph } from './streets/graph';

export type Turn = 'straight' | 'right' | 'left' | 'uturn' | 'lane';

/** Полоса: проезд по ребру улиц в одну сторону. */
export interface Lane {
  id: number;
  /** Ребро графа улиц. */
  edge: number;
  /** Направление проезда: индекс DIRS (0 +x, 1 -x, 2 +y, 3 -y). */
  dir: number;
  /** Клетка узла на входе. */
  from: number;
  /** Клетка узла на выходе. */
  to: number;
  /** Прямые клетки ребра в порядке проезда. */
  cells: number[];
  /** Номер полосы: 0 - крайняя правая, 1 - левая. */
  lane: number;
  /** Смещение от оси клетки к правой стороне по ходу. */
  offset: number;
  /** Точки полосы парами x, z. */
  pts: number[];
  /** Длина пути до каждой точки. */
  dist: number[];
  /** Полная длина. */
  len: number;
}

/** Манёвр: переход с одной полосы на другую. */
export interface Maneuver {
  id: number;
  from: number;
  to: number;
  turn: Turn;
  /** Клетка манёвра: узел перекрёстка или (для перестроения) клетка ребра. */
  node: number;
  /** Для перестроения - номер клетки ребра, где начинается сдвиг. */
  at: number;
  /** Кривая манёвра внутри клетки. */
  pts: number[];
  len: number;
}

/** Направление езды по ленте проспекта: сторона пары -> индекс DIRS. */
export const BAND_TRAVEL = [2, 3, 1, 0];

/** Цена манёвра кроме длины полосы: повороты дороже прямой. */
const TURN_COST: Record<Turn, number> = { straight: 0, right: 0.25, left: 0.4, uturn: 4, lane: 0.25 };

/** Поворот из направления входа din в направление выхода dout. */
export function turnOf(din: number, dout: number): Turn {
  if (din === dout) return 'straight';
  if (dout === (din ^ 1)) return 'uturn';
  return dout === [2, 3, 1, 0][din] ? 'right' : 'left';
}

/** Двоичная куча для Дейкстры: пары "полоса, цена". */
class Heap {
  private ids: number[] = [];
  private keys: number[] = [];
  get size() { return this.ids.length; }
  push(id: number, key: number) {
    this.ids.push(id); this.keys.push(key);
    let i = this.ids.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.keys[p] <= this.keys[i]) break;
      this.swap(i, p);
      i = p;
    }
  }
  pop(): { id: number; key: number } | null {
    if (!this.ids.length) return null;
    const out = { id: this.ids[0], key: this.keys[0] };
    const last = this.ids.pop()!;
    const lastKey = this.keys.pop()!;
    if (this.ids.length) {
      this.ids[0] = last; this.keys[0] = lastKey;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1, r = l + 1;
        let m = i;
        if (l < this.ids.length && this.keys[l] < this.keys[m]) m = l;
        if (r < this.ids.length && this.keys[r] < this.keys[m]) m = r;
        if (m === i) break;
        this.swap(i, m);
        i = m;
      }
    }
    return out;
  }
  private swap(a: number, b: number) {
    [this.ids[a], this.ids[b]] = [this.ids[b], this.ids[a]];
    [this.keys[a], this.keys[b]] = [this.keys[b], this.keys[a]];
  }
}

/** Манёвр без полос: как ехать и куда (для отрисовки и отладки). */
export interface LaneRoute {
  /** Id манёвров по порядку. */
  maneuvers: number[];
  /** Id полос по порядку: на одну больше, чем манёвров. */
  lanes: number[];
}

/** Что нужно машине, чтобы ехать по маршруту: клетки, смещения полос и места перестроения. */
export interface LaneChange {
  /** Номер клетки в пути, с середины которой начинается сдвиг. */
  index: number;
  /** Клетка ребра, где идёт сдвиг. */
  cell: number;
  /** Смещение новой (целевой) полосы. */
  offset: number;
  /** Смещение, с которого машина начинает сдвиг. */
  from: number;
}
export interface DrivePlan {
  path: number[];
  offsets: number[];
  /** Перестроения: клетка, у середины которой начинается сдвиг, и смещение новой полосы. */
  changes: LaneChange[];
  maneuvers: number[];
}

export class LaneGraph {
  size = 0;
  lanes: Lane[] = [];
  maneuvers: Maneuver[] = [];
  /** Полосы по клеткам: проезжающие через клетку. */
  private through = new Map<number, number[]>();
  private outs: number[][] = [];
  private ins: number[][] = [];
  /** Число полос на ребро (1 - улица, 2 - проспект). */
  private perEdge: number[] = [];
  /** Тупики: клетки узлов с одним выходом. */
  deadEnds = new Set<number>();
  private best = new Float64Array(0);

  reset() {
    this.size = 0;
    this.lanes = [];
    this.maneuvers = [];
    this.through.clear();
    this.outs = [];
    this.ins = [];
    this.perEdge = [];
    this.deadEnds.clear();
  }

  build(w: World, streets: StreetGraph): void {
    this.reset();
    this.size = streets.size;
    const s = streets.size;
    const drivable = (cell: number) => {
      const t = w.tiles[cell];
      return !!t && t.object === 'road' && w.explored[cell] === 1;
    };
    const index = new Int32Array(streets.edges.length * 8).fill(-1);
    // Полосы: у каждой стороны ребра своё направление; у проспекта езда только по ленте
    for (let e = 0; e < streets.edges.length; e++) {
      const edge = streets.edges[e];
      if (!drivable(edge.a) || !drivable(edge.b)) continue;
      if (edge.cells.some((c) => !drivable(c))) continue;
      let kind = streets.kind[edge.a] > streets.kind[edge.b] ? streets.kind[edge.a] : streets.kind[edge.b];
      for (const c of edge.cells) if (streets.kind[c] > kind) kind = streets.kind[c];
      let dirs: number[] = [edge.dir, edge.dir ^ 1];
      let count = 1;
      const avenue = kind === 1;
      if (avenue) {
        const band = streets.bandOf(edge.cells[0] ?? edge.a);
        const travel = band ? BAND_TRAVEL[band.side] : -1;
        // Лента должна идти вдоль ребра: иначе это не тот проспект, считаем улицей
        if (travel === edge.dir || travel === (edge.dir ^ 1)) {
          dirs = [travel];
          count = AVENUE_LANES.length;
        }
      }
      this.perEdge[e] = count;
      for (const dir of dirs) {
        const forward = dir === edge.dir;
        const cells = forward ? edge.cells : [...edge.cells].reverse();
        const from = forward ? edge.a : edge.b, to = forward ? edge.b : edge.a;
        for (let k = 0; k < count; k++) {
          const offset = count === 1 ? STREET_LANE : AVENUE_LANES[k];
          const lane = this.makeLane(e, dir, from, to, cells, k, offset);
          index[(e * 4 + dir) * 2 + k] = lane.id;
        }
      }
    }
    // Манёвры на узлах: вход -> выход по правилам FR-021
    const insByNode = new Map<number, number[]>(), outsByNode = new Map<number, number[]>();
    const addTo = (map: Map<number, number[]>, cell: number, id: number) => {
      const list = map.get(cell);
      if (list) list.push(id);
      else map.set(cell, [id]);
    };
    for (const lane of this.lanes) {
      addTo(outsByNode, lane.from, lane.id);
      addTo(insByNode, lane.to, lane.id);
    }
    for (const node of streets.nodes.values()) {
      if (node.kind === 'single') continue;
      if (node.kind === 'end') this.deadEnds.add(node.cell);
      const ins = insByNode.get(node.cell) ?? [], outs = outsByNode.get(node.cell) ?? [];
      for (const inId of ins) {
        for (const outId of outs) {
          const a = this.lanes[inId], b = this.lanes[outId];
          const turn = turnOf(a.dir, b.dir);
          if (!this.allowed(turn, a, b, node.kind === 'end')) continue;
          this.addManeuver(a, b, turn, node.cell, -1);
        }
      }
    }
    // Перестроение на прямых отрезках проспекта: за 2-3 клетки до узла
    for (let e = 0; e < this.perEdge.length; e++) {
      if (this.perEdge[e] !== 2) continue;
      const edge = streets.edges[e];
      if (edge.cells.length < 2) continue;
      const at = Math.max(0, edge.cells.length - 3);
      const changeCell = edge.cells[at];
      for (const dir of [edge.dir, edge.dir ^ 1]) {
        const a = this.lanes[index[(e * 4 + dir) * 2]];
        const b = this.lanes[index[(e * 4 + dir) * 2 + 1]];
        if (!a || !b || a.id === b.id) continue;
        this.addManeuver(a, b, 'lane', changeCell, at);
        this.addManeuver(b, a, 'lane', changeCell, at);
      }
    }
  }

  /** Разрешён ли манёвр: с правой полосы направо и прямо, с левой налево и прямо. */
  private allowed(turn: Turn, a: Lane, b: Lane, deadEnd: boolean): boolean {
    const last = (lane: Lane) => lane.lane === (this.perEdge[lane.edge] ?? 1) - 1;
    switch (turn) {
      case 'straight': return b.lane === Math.min(a.lane, (this.perEdge[b.edge] ?? 1) - 1);
      case 'right': return a.lane === 0 && b.lane === 0;
      case 'left': return last(a) && last(b);
      case 'uturn': return deadEnd && last(a) && last(b);
      default: return false;
    }
  }

  private makeLane(edge: number, dir: number, from: number, to: number, cells: number[], lane: number, offset: number): Lane {
    const s = this.size;
    const [dx, dz] = DIRS[dir];
    const rx = -dz, rz = dx;
    const pts: number[] = [];
    const dist: number[] = [0];
    const push = (x: number, z: number) => {
      const n = pts.length;
      if (n && Math.hypot(x - pts[n - 2], z - pts[n - 1]) < 1e-6) return;
      if (n) dist.push(dist[dist.length - 1] + Math.hypot(x - pts[n - 2], z - pts[n - 1]));
      pts.push(x, z);
    };
    push((from % s) + 0.5 + dx * 0.5 + rx * offset, ((from / s) | 0) + 0.5 + dz * 0.5 + rz * offset);
    for (const cell of cells) push((cell % s) + 0.5 + rx * offset, ((cell / s) | 0) + 0.5 + rz * offset);
    push((to % s) + 0.5 - dx * 0.5 + rx * offset, ((to / s) | 0) + 0.5 - dz * 0.5 + rz * offset);
    const id = this.lanes.length;
    const result: Lane = { id, edge, dir, from, to, cells, lane, offset, pts, dist, len: dist[dist.length - 1] };
    this.lanes.push(result);
    this.outs[id] = [];
    this.ins[id] = [];
    for (const cell of [from, to, ...cells]) {
      const list = this.through.get(cell);
      if (list) list.push(id);
      else this.through.set(cell, [id]);
    }
    return result;
  }

  private addManeuver(a: Lane, b: Lane, turn: Turn, node: number, at: number): void {
    const pts = turn === 'lane' ? [] : this.maneuverCurve(node, a, b, turn);
    let len = 0;
    for (let i = 2; i < pts.length; i += 2) len += Math.hypot(pts[i] - pts[i - 2], pts[i + 1] - pts[i - 1]);
    const id = this.maneuvers.length;
    this.maneuvers.push({ id, from: a.id, to: b.id, turn, node, at, pts, len });
    this.outs[a.id].push(id);
    this.ins[b.id].push(id);
  }

  /** Кривая манёвра в клетке узла: дуга поворота или отрезок прямой. */
  private maneuverCurve(node: number, a: Lane, b: Lane, turn: Turn): number[] {
    const s = this.size, [dx, dz] = DIRS[a.dir], [ex, ez] = DIRS[b.dir];
    const cx = (node % s) + 0.5, cz = ((node / s) | 0) + 0.5;
    if (turn === 'lane') return [];
    if (turn === 'straight') {
      const ax = -dz, az = dx, bx = -ez, bz = ex;
      return [
        cx - dx * 0.5 + ax * a.offset, cz - dz * 0.5 + az * a.offset,
        cx + ex * 0.5 + bx * b.offset, cz + ez * 0.5 + bz * b.offset,
      ];
    }
    return turnArc(cx, cz, a.dir, b.dir, a.offset, b.offset);
  }

  /** Манёвры, выходящие из полосы (включая перестроение). */
  out(lane: number): Maneuver[] {
    return (this.outs[lane] ?? []).map((id) => this.maneuvers[id]);
  }

  /** Манёвры, входящие в полосу. */
  into(lane: number): Maneuver[] {
    return (this.ins[lane] ?? []).map((id) => this.maneuvers[id]);
  }

  /** Полоса, проходящая через клетку в направлении dir (крайняя правая из подходящих). */
  laneAt(cell: number, dir: number): number | null {
    for (const id of this.through.get(cell) ?? []) if (this.lanes[id].dir === dir) return id;
    return null;
  }

  /** Все полосы через клетку. */
  lanesAt(cell: number): Lane[] {
    return (this.through.get(cell) ?? []).map((id) => this.lanes[id]);
  }

  /** Стартовые полосы поездки: те, что проходят через клетку выезда или начинаются в ней. */
  private starts(fromCell: number): number[] {
    const out: number[] = [];
    for (const id of this.through.get(fromCell) ?? []) if (this.lanes[id].cells.includes(fromCell) || this.lanes[id].from === fromCell) out.push(id);
    return out;
  }

  /** Полосы, на которых заканчивается поездка. */
  private goals(toCell: number): Set<number> {
    const out = new Set<number>();
    for (const id of this.through.get(toCell) ?? []) if (this.lanes[id].cells.includes(toCell) || this.lanes[id].to === toCell) out.add(id);
    return out;
  }

  /** Путь по манёврам между двумя дорожными клетками; null - пути нет. */
  route(fromCell: number, toCell: number): LaneRoute | null {
    const starts = this.starts(fromCell);
    const goals = this.goals(toCell);
    if (!starts.length || !goals.size) return null;
    const direct = starts.find((id) => {
      if (!goals.has(id)) return false;
      const lane = this.lanes[id];
      const from = lane.cells.indexOf(fromCell);
      const to = toCell === lane.to ? lane.cells.length : lane.cells.indexOf(toCell);
      return to >= from;
    });
    if (direct !== undefined) return { maneuvers: [], lanes: [direct] };
    const n = this.lanes.length;
    // До первого поворота едем от клетки старта, при повторном въезде - от начала полосы.
    if (this.best.length !== 2 * n) this.best = new Float64Array(2 * n);
    const best = this.best.fill(Infinity);
    const prevLane = new Int32Array(best.length).fill(-1), prevM = new Int32Array(best.length).fill(-1);
    const heap = new Heap();
    for (const id of starts) {
      const lane = this.lanes[id];
      // Путь считаем от клетки выезда до конца полосы; левая полоса - только через перестроение
      const at = lane.cells.indexOf(fromCell);
      const rest = lane.len - (at >= 0 ? lane.dist[Math.min(at + 1, lane.dist.length - 1)] : 0);
      const cost = rest + lane.lane;
      best[id + n] = cost;
      heap.push(id + n, cost);
    }
    let found = -1;
    while (heap.size) {
      const top = heap.pop()!;
      if (top.key > best[top.id] + 1e-9) continue;
      const starting = top.id >= n;
      const lane = this.lanes[top.id % n];
      if (!starting && goals.has(lane.id)) { found = top.id; break; }
      for (const m of this.out(lane.id)) {
        const onStartingEdge = starting && m.turn === 'lane';
        if (onStartingEdge && m.at < lane.cells.indexOf(fromCell)) continue;
        const next = onStartingEdge ? m.to + n : m.to;
        const cost = top.key + this.cost(m);
        if (cost >= best[next] - 1e-9) continue;
        best[next] = cost;
        prevLane[next] = top.id;
        prevM[next] = m.id;
        heap.push(next, cost);
      }
    }
    if (found < 0) return null;
    const maneuvers: number[] = [], lanes: number[] = [];
    for (let v = found; v >= 0; v = prevLane[v]) {
      lanes.push(v % n);
      if (prevM[v] >= 0) maneuvers.push(prevM[v]);
    }
    maneuvers.reverse();
    lanes.reverse();
    return { maneuvers, lanes };
  }

  /** Цена манёвра для маршрута: длина полосы плюс надбавка за поворот. */
  cost(m: Maneuver): number {
    const lane = this.lanes[m.to];
    const right = lane.lane * 0.06;
    if (m.turn !== 'lane') return lane.len + TURN_COST[m.turn] + right;
    // Перестроение: остаток ребра уже оплачен входом в полосу, цена - только сдвиг
    return TURN_COST.lane + right;
  }

  /**
   * План движения по маршруту: клетки от выезда до цели, смещение полосы по клеткам
   * и места перестроения. null - маршрут не подходит, машине нужен прежний путь.
   */
  plan(route: LaneRoute, fromCell: number, toCell: number): DrivePlan | null {
    const lanes = route.lanes.map((id) => this.lanes[id]);
    if (!lanes.length || !lanes[0]) return null;
    const path: number[] = [];
    const offsets: number[] = [];
    const changes: LaneChange[] = [];
    // Перестроение относится к текущему проезду по ребру. Маршрут может вернуться на него.
    let change: { at: number; offset: number } | null = null;
    const push = (cell: number, offset: number) => {
      if (path[path.length - 1] === cell) { offsets[offsets.length - 1] = offset; return; }
      path.push(cell);
      offsets.push(offset);
    };
    /** Смещение полосы на клетке ребра: после перестроения - смещение новой полосы. */
    const offAt = (lane: Lane, i: number) => {
      return change && i > change.at ? change.offset : lane.offset;
    };
    /** Дописать клетки полосы с from до to включительно, отметив начало перестроения. */
    const addCells = (lane: Lane, from: number, to: number) => {
      for (let i = Math.max(0, from); i <= Math.min(lane.cells.length - 1, to); i++) {
        if (change && i === change.at + 1) changes.push({ index: path.length, cell: lane.cells[i], offset: change.offset, from: lane.offset });
        push(lane.cells[i], offAt(lane, i));
      }
    };
    const first = lanes[0];
    const i0 = first.cells.indexOf(fromCell);
    if (i0 < 0 && fromCell !== first.from) return null;
    push(fromCell, first.offset);
    let lane = first;
    let k = i0;
    for (const id of route.maneuvers) {
      const m = this.maneuvers[id];
      if (m.turn === 'lane') {
        change = { at: m.at, offset: this.lanes[m.to].offset };
        continue;
      }
      addCells(lane, k + 1, lane.cells.length - 1);
      push(m.node, offAt(lane, lane.cells.length - 1));
      lane = this.lanes[m.to];
      k = -1;
      change = null;
    }
    const kTo = lane.cells.indexOf(toCell);
    if (kTo >= 0 && kTo < k) return null;
    if (kTo >= 0) addCells(lane, k + 1, kTo);
    else {
      addCells(lane, k + 1, lane.cells.length - 1);
      push(toCell, offAt(lane, lane.cells.length - 1));
    }
    return { path, offsets, changes, maneuvers: route.maneuvers };
  }
}

/**
 * Проверка графа полос: у манёвра есть вход и выход, у каждой полосы есть вход и выход
 * (кроме тупика), длины непустые. Пустой массив - всё верно.
 */
export function checkLanes(w: World, graph: LaneGraph): string[] {
  const errors: string[] = [];
  const name = (cell: number) => `(${cell % graph.size},${(cell / graph.size) | 0})`;
  for (const lane of graph.lanes) {
    if (lane.len < 0) errors.push(`полоса ${lane.id} ${name(lane.from)}->${name(lane.to)}: длина отрицательная`);
    if (!graph.out(lane.id).length && !graph.deadEnds.has(lane.to)) errors.push(`полоса ${lane.id} ${name(lane.from)}->${name(lane.to)}: нет выхода`);
    if (!graph.into(lane.id).length && !graph.deadEnds.has(lane.from)) errors.push(`полоса ${lane.id} ${name(lane.from)}->${name(lane.to)}: нет входа`);
    if (!w.tiles[lane.from] || w.tiles[lane.from].object !== 'road') errors.push(`полоса ${lane.id}: вход не на дороге`);
  }
  for (const m of graph.maneuvers) {
    if (!graph.lanes[m.from] || !graph.lanes[m.to]) errors.push(`манёвр ${m.id}: нет полосы входа или выхода`);
    if (m.turn !== 'lane' && m.from === m.to) errors.push(`манёвр ${m.id}: вход и выход - одна полоса`);
  }
  return errors;
}
