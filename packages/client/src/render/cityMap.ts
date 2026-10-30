// План улиц города: где дороги, где у зданий вход, где переходы и как по улицам ходить и ездить.
// Один план на всех: машины (traffic.ts) берут из него места и маршруты, пешеходы
// (pedestrians.ts) - тротуары и переходы, отрисовка дорог (cityMesh.ts) - клетки с зеброй.

import { BUILDING_BY_ID } from '@avi/data';
import { builtLevel, CAPACITY, decodeLot, DIRS, type World } from '@avi/sim';
import { MODELS } from './models';
import { MAIN_X, MAIN_Z, mainStreets, signalJunction } from './streets/main';

export type PlaceKind = 'home' | 'shop' | 'work' | 'farm' | 'school' | 'clinic' | 'service' | 'stroll';

/** Показание светофора: ось улицы (0 - восток-запад, 1 - север-юг) и цвет для машин этой оси. */
export type LightPhase = 'green' | 'yellow' | 'red';
export type LightAxis = 0 | 1;

/** Сколько секунд игрового времени горит каждая фаза светофора. */
const GREEN_TIME = 12;
const YELLOW_TIME = 2.5;
/** Красный для всех: въехавшие на жёлтый успевают покинуть перекрёсток. */
const ALL_RED = 1.5;
const SIGNAL_CYCLE = (GREEN_TIME + YELLOW_TIME + ALL_RED) * 2;

/** Место, куда ходят и ездят: вход с клетки дороги и точка у бордюра на стороне здания. */
export interface Place {
  /** Клетка дороги у входа. */
  road: number;
  /** Точка у бордюра: тут паркуется машина, отсюда человек идёт к двери. */
  x: number;
  z: number;
  /** Клетка здания (у участка - главная клетка участка). */
  cell: number;
  kind: PlaceKind;
  weight: number;
  /** Направление от здания к дороге (индекс DIRS): куда смотрит вход. */
  dir: number;
}

export interface MapUpdate {
  /** Поменялся набор мест - агентов (семьи, пешеходов) пора пересоздать. */
  places: boolean;
  /** Поменялись клетки с зеброй - чанки дорог надо перерисовать. */
  crossings: boolean;
}

const KAY = 0.5;
/** Смещение полосы пешехода от оси дороги: тротуара в плитке нет, люди идут по краю полотна. */
export const WALK_LANE = 0.42;
/** Смещение полосы машины от оси дороги: движение правостороннее. */
export const CAR_LANE = 0.13;
/** Дверь здания: на плите участка у фасада, со стороны улицы. */
const DOOR_STEP = 0.62;
/** Промзоны и мастерские - рабочие места, остальные постройки - службы. */
const WORK_DEFS = new Set(['mine', 'workshop']);

/** Высота асфальта - по центру дорожной модели, чтобы колёса и ноги стояли на полотне. */
let roadTopValue = -1;
export function roadTop(): number {
  if (roadTopValue >= 0) return roadTopValue;
  const road = MODELS.road_straight.pos;
  let top = 0;
  for (let i = 0; i < road.length; i += 3) if (Math.abs(road[i]) < 0.3 && Math.abs(road[i + 2]) < 0.3) top = Math.max(top, road[i + 1]);
  roadTopValue = top * KAY;
  return roadTopValue;
}

const bits = (m: number) => (m & 1) + ((m >> 1) & 1) + ((m >> 2) & 1) + ((m >> 3) & 1);

export class CityMap {
  size = 0;
  isRoad = new Uint8Array(0);
  /** Соседи-дороги по сторонам клетки: биты по индексам DIRS. */
  roadMask = new Uint8Array(0);
  /** Клетки, где нарисована зебра. */
  crossings = new Set<number>();
  /** Ось улицы у зебры на перекрёстке: светофор этой оси и ждут машины с людьми. */
  crossAxis = new Map<number, LightAxis>();
  /** Главные улицы по клеткам (streets/main.ts): MAIN_X - вдоль x, MAIN_Z - вдоль z. */
  main: Uint8Array = new Uint8Array(0);
  /** Часы светофоров в секундах игрового времени. */
  private signalClock = 0;
  homes: Place[] = [];
  shops: Place[] = [];
  jobs: Place[] = [];
  schools: Place[] = [];
  clinics: Place[] = [];
  farms: Place[] = [];
  private world: World | null = null;
  private revision = -1;
  private prev = new Int32Array(0);
  private signature = '';

  /** Пересчитать план под мир. Дёшево вызывать каждый кадр: работа только при изменении мира. */
  update(w: World): MapUpdate {
    if (this.world === w && this.revision === w.revision) return { places: false, crossings: false };
    this.world = w;
    this.revision = w.revision;
    this.size = w.size;
    const n = w.size * w.size;
    this.isRoad = new Uint8Array(n);
    // Старые улицы под туманом войны городу не принадлежат: по ним не ездят и не ходят
    w.tiles.forEach((t, i) => { if (t.object === 'road' && w.explored[i]) this.isRoad[i] = 1; });
    // Соседи-дороги: нужны и зебрам, и светофорам, и поворотам
    this.roadMask = new Uint8Array(n);
    for (let y = 0; y < w.size; y++) {
      for (let x = 0; x < w.size; x++) {
        const i = y * w.size + x;
        if (!this.isRoad[i]) continue;
        let m = 0;
        for (let d = 0; d < 4; d++) {
          const nx = x + DIRS[d][0], ny = y + DIRS[d][1];
          if (nx >= 0 && ny >= 0 && nx < w.size && ny < w.size && this.isRoad[ny * w.size + nx]) m |= 1 << d;
        }
        this.roadMask[i] = m;
      }
    }

    const homes: Place[] = [], shops: Place[] = [], jobs: Place[] = [], schools: Place[] = [], clinics: Place[] = [], farms: Place[] = [];
    w.tiles.forEach((t, i) => {
      if (t.object === 'zone' && t.zone) {
        const level = builtLevel(t);
        if (level <= 0) return;
        // Жильё и торговля - участками: вход у главной клетки; промзоны и фермы - каждая клетка
        if (t.lot === 0 && t.root >= 0 && t.root !== i) return;
        const lot = decodeLot(t.lot);
        const kind: PlaceKind = t.zone === 'R' ? 'home' : t.zone === 'C' ? 'shop' : t.zone === 'A' ? 'farm' : 'work';
        const p = this.place(w, i, CAPACITY[t.zone][level], lot ? lot.dir : -1, kind);
        if (!p) return;
        if (kind === 'home') homes.push(p);
        else {
          jobs.push(p);
          if (kind === 'shop') shops.push(p);
          if (kind === 'farm') farms.push(p);
        }
      } else if (t.object === 'building' && t.root === i && t.build === 0) {
        const def = BUILDING_BY_ID[t.def!];
        if (!def) return;
        const kind: PlaceKind =
          def.service?.kind === 'education' ? 'school'
            : def.service?.kind === 'health' ? 'clinic'
              : WORK_DEFS.has(def.id) ? 'work' : 'service';
        const p = this.place(w, i, 6, -1, kind);
        if (!p) return;
        jobs.push(p);
        if (kind === 'school') schools.push({ ...p, weight: 1 });
        if (kind === 'clinic') clinics.push(p);
      }
    });
    Object.assign(this, { homes, shops, jobs, schools, clinics, farms });

    // Главные улицы: от них зависят разметка, светофоры и кто едет первым
    const mainBefore = this.main;
    this.main = mainStreets(w);
    let mainDone = mainBefore.length !== this.main.length;
    for (let i = 0; !mainDone && i < this.main.length; i++) if (this.main[i] !== mainBefore[i]) mainDone = true;
    // Зебры: только у перекрёстков и у входа в школу и лазарет
    const before = this.crossings;
    const after = this.crossingCells(w, [...schools, ...clinics]);
    this.crossings = after;
    let crossingsDone = mainDone || after.size !== before.size;
    if (!crossingsDone) for (const c of after) if (!before.has(c)) { crossingsDone = true; break; }
    const signature = [homes, jobs, schools, clinics, shops, farms].map((l) => l.map((p) => `${p.road}:${p.weight}`).join(',')).join('|');
    const places = signature !== this.signature;
    this.signature = signature;
    return { places, crossings: crossingsDone || places };
  }

  /** Новый мир (новая игра, загрузка): план считается заново. */
  reset() {
    this.world = null;
    this.revision = -1;
    this.signature = '';
    this.crossings = new Set();
    this.crossAxis = new Map();
    this.main = new Uint8Array(0);
    this.isRoad = new Uint8Array(0);
    this.roadMask = new Uint8Array(0);
  }

  /** Вход места: соседняя дорога (у участка - в сторону его улицы), иначе ближайшая в 2 клетках. */
  private place(w: World, idx: number, weight: number, dir: number, kind: PlaceKind): Place | null {
    const s = w.size;
    const x = idx % s, y = Math.floor(idx / s);
    // Здание 2x2 ищет дорогу вокруг всех своих клеток
    const def = w.tiles[idx].object === 'building' ? BUILDING_BY_ID[w.tiles[idx].def!] : undefined;
    const size = def?.size ?? 1;
    const order = dir >= 0 ? [dir, 0, 1, 2, 3] : [0, 1, 2, 3];
    for (let r = 1; r <= 2; r++) {
      for (let cy = y; cy < y + size; cy++) {
        for (let cx = x; cx < x + size; cx++) {
          for (const d of order) {
            const nx = cx + DIRS[d][0] * r, ny = cy + DIRS[d][1] * r;
            if (nx < 0 || ny < 0 || nx >= s || ny >= s || !this.isRoad[ny * s + nx]) continue;
            // Парковка у бордюра на стороне участка
            const bx = nx - DIRS[d][0] * 0.42, bz = ny - DIRS[d][1] * 0.42;
            return { road: ny * s + nx, x: bx + 0.5, z: bz + 0.5, cell: idx, kind, weight, dir: d };
          }
        }
      }
    }
    return null;
  }

  /**
   * Клетки с зеброй. Правило: прямая дорога (две полосы навстречу) рядом с перекрёстком
   * и по одной зебре у входа в школу и лазарет. У перекрёстка двух главных улиц зебра со
   * светофором - ось её улицы запоминается в crossAxis.
   */
  private crossingCells(w: World, important: Place[]): Set<number> {
    const s = w.size, n = s * s;
    const mask = this.roadMask;
    // Прямая: соседи только с двух противоположных сторон (3 - восток и запад, 12 - север и юг)
    const straight = (i: number) => this.isRoad[i] === 1 && (mask[i] === 3 || mask[i] === 12);
    const out = new Set<number>();
    this.crossAxis = new Map();
    for (let i = 0; i < n; i++) {
      if (!straight(i)) continue;
      const x = i % s, y = Math.floor(i / s);
      let junction = false, signal = false;
      for (const [dx, dy] of DIRS) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= s || ny >= s) continue;
        const ni = ny * s + nx;
        if (this.isRoad[ni] && bits(mask[ni]) >= 3) {
          junction = true;
          if (signalJunction(this.main, ni)) signal = true;
        }
      }
      if (!junction) continue;
      out.add(i);
      // Светофор только у перекрёстка двух главных: ось улицы - та, по которой едут машины через зебру
      if (signal) this.crossAxis.set(i, mask[i] === 3 ? 0 : 1);
    }
    // У входа в школу и лазарет - своя зебра без светофора: на клетке входа,
    // а если там поворот или перекрёсток - на соседней прямой клетке
    for (const p of important) {
      if (out.has(p.road)) continue;
      if (straight(p.road)) {
        out.add(p.road);
        continue;
      }
      const x = p.road % s, y = Math.floor(p.road / s);
      for (const [dx, dy] of DIRS) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= s || ny >= s) continue;
        const ni = ny * s + nx;
        if (straight(ni)) {
          out.add(ni);
          break;
        }
      }
    }
    return out;
  }

  /** Часы светофоров идут вместе с игровым временем: на паузе стоят. */
  advanceSignals(dt: number) {
    this.signalClock = (this.signalClock + dt) % SIGNAL_CYCLE;
  }

  /** Цвет для машин оси: оси горят по очереди, между ними жёлтый. */
  light(axis: LightAxis): LightPhase {
    const t = (this.signalClock + (axis === 1 ? GREEN_TIME + YELLOW_TIME + ALL_RED : 0)) % SIGNAL_CYCLE;
    if (t < GREEN_TIME) return 'green';
    if (t < GREEN_TIME + YELLOW_TIME) return 'yellow';
    return 'red';
  }

  /** Перекрёсток со светофором: три и больше улиц, и через него идут две главные. */
  isSignal(cell: number): boolean {
    return this.isJunction(cell) && signalJunction(this.main, cell);
  }

  /** Клетка - часть главной улицы вдоль оси шага (dx, dy). */
  isMainAlong(cell: number, dx: number): boolean {
    return (this.main[cell] & (dx !== 0 ? MAIN_X : MAIN_Z)) !== 0;
  }

  /** Перекрёсток - клетка дороги, от которой отходит три и больше улиц. */
  isJunction(cell: number): boolean {
    return bits(this.roadMask[cell] ?? 0) >= 3;
  }

  /** Дверь здания: точка на плите участка у фасада со стороны улицы. */
  door(p: Place): { x: number; z: number } {
    const s = this.size;
    const rx = (p.road % s) + 0.5, rz = Math.floor(p.road / s) + 0.5;
    return { x: rx - DIRS[p.dir][0] * DOOR_STEP, z: rz - DIRS[p.dir][1] * DOOR_STEP };
  }

  /** Кратчайший путь по клеткам дорог (поиск в ширину); null - не связаны. */
  path(from: number, to: number): number[] | null {
    if (!this.isRoad[from] || !this.isRoad[to]) return null;
    if (this.prev.length !== this.isRoad.length) this.prev = new Int32Array(this.isRoad.length);
    const prev = this.prev.fill(-1);
    prev[from] = from;
    const queue = [from];
    const size = this.size;
    for (let q = 0; q < queue.length; q++) {
      const c = queue[q];
      if (c === to) break;
      const x = c % size, y = Math.floor(c / size);
      for (const [dx, dy] of DIRS) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue;
        const ni = ny * size + nx;
        if (prev[ni] < 0 && this.isRoad[ni]) {
          prev[ni] = c;
          queue.push(ni);
        }
      }
    }
    if (prev[to] < 0) return null;
    const out = [to];
    while (out[out.length - 1] !== from) out.push(prev[out[out.length - 1]]);
    return out.reverse();
  }

  /** Клетки дорог не дальше steps шагов по дорогам от from (поиск в ширину). */
  near(from: number, steps: number): Set<number> {
    const out = new Set<number>();
    if (!this.isRoad[from]) return out;
    out.add(from);
    const size = this.size;
    let wave = [from];
    for (let d = 0; d < steps && wave.length; d++) {
      const next: number[] = [];
      for (const c of wave) {
        const x = c % size, y = Math.floor(c / size);
        for (const [dx, dy] of DIRS) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue;
          const ni = ny * size + nx;
          if (this.isRoad[ni] && !out.has(ni)) {
            out.add(ni);
            next.push(ni);
          }
        }
      }
      wave = next;
    }
    return out;
  }

  /**
   * Точки вдоль клеток пути на полосе lane; side = 1 - правая сторона по ходу, -1 - левая.
   * На повороте точка сдвигается на обе полосы сразу - угол получается без ступеньки.
   */
  route(path: number[], lane: number, side = 1): number[] {
    const size = this.size;
    const pts: number[] = [];
    if (path.length < 2) return pts;
    const cell = (i: number) => [path[i] % size, Math.floor(path[i] / size)];
    const dir = (a: number, b: number) => {
      const [ax, ay] = cell(a), [bx, by] = cell(b);
      return [bx - ax, by - ay];
    };
    // Правая сторона по ходу (x, z): для движения по +x это +z
    const right = ([dx, dz]: number[]) => [-dz * side, dx * side];
    for (let i = 0; i < path.length; i++) {
      const din = dir(Math.max(0, i - 1), Math.max(1, i));
      const dout = i < path.length - 1 ? dir(i, i + 1) : din;
      const [cx, cz] = cell(i);
      const r1 = right(i === 0 ? dout : din), r2 = right(dout);
      const turn = i > 0 && (din[0] !== dout[0] || din[1] !== dout[1]);
      pts.push(cx + 0.5 + (r1[0] + (turn ? r2[0] : 0)) * lane, cz + 0.5 + (r1[1] + (turn ? r2[1] : 0)) * lane);
    }
    return pts;
  }
}
