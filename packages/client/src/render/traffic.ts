// Машины на улицах живут по распорядку дня: утром родители везут детей в школу и едут на работу,
// в обед и вечером заезжают в магазины, после работы возвращаются домой; грузовики возят товар
// с промзон и ферм в торговлю, ночью по городу ездят такси и полиция.
// Только вид: на симуляцию не влияет, расписание строится заново каждые игровые сутки.
// Где входы зданий, как проложить путь и где зебры - знает план улиц (cityMap.ts).

import * as THREE from 'three';
import { SPEED_FACTOR, type World } from '@avi/sim';
import { CYCLE_START_HOUR as DAY_START_HOUR } from './dayCycle';
import { CityMap, CAR_LANE, roadTop, type Place } from './cityMap';
import { GeoBuilder } from './builder';
import { MODELS, type ModelName } from './models';

/** hour - час от начала игровых суток: 6..30, ночь после полуночи - 24..30. */
interface Trip { hour: number; to: Place }

/** Семья (или служба) со своей машиной: где она сейчас и куда поедет сегодня. */
interface Agent {
  home: Place;
  work: Place | null;
  school: Place | null;
  kind: 'family' | 'truck' | 'taxi' | 'police';
  model: number;
  at: Place;
  plan: Trip[];
  /** Не выезжать раньше этого часа (6..30): стоянка у школы, в магазине. */
  wait: number;
  car: Car | null;
}

interface Car {
  /** Порядковый номер: из двух машин, мешающих друг другу, первой едет младшая. */
  id: number;
  agent: Agent;
  to: Place;
  /** Клетки дорог по маршруту. */
  path: number[];
  /** Точки маршрута парами x, z. */
  pts: number[];
  seg: number;
  t: number;
  yaw: number;
  /** Сколько секунд машина стоит, не имея возможности ехать. */
  blocked: number;
  /** Машина, за которой стоим в этом кадре: по ней разбираем взаимные помехи. */
  blocker: Car | null;
}

/** Почему машина стоит: люди на зебре, красный, уступает встречной, впереди машина. */
type StopKind = 'none' | 'people' | 'light' | 'yield' | 'car';

const KAY = 0.5;
const CAR_SCALE = KAY * 0.5;
/** Низ колёс машин KayKit ниже точки привязки модели (как у машин на участках). */
const WHEEL_DROP = 0.061;
/**
 * Скорость в клетках за секунду на x1 - как в жизни: клетка ~10 м (рост жителя 0.16 клетки),
 * 1 клетка/с ~ 40 км/ч по городу. На x2 и x4 растёт не вровень со временем, иначе машины мелькают.
 */
const SPEED = 1;
const SPEED_POWER = 0.7;
/** Столько жителей на одну машину. */
const PEOPLE_PER_CAR = 7;
/** Перед зеброй машина останавливается, не доезжая до неё: полклетки - это и есть полоса перехода. */
const STOP_GAP = 0.46;
/** Машина, которой не дают проехать дольше этого, едет дальше: улица не должна заклинить. */
const STUCK_LIMIT = 12;
/** Красный свет горит дольше предохранителя людей: на светофоре ждать можно, но не вечно. */
const RED_LIMIT = 18;
/** Расстояние между центрами машин в пробке: длина машины ~0.25 и зазор. */
const FOLLOW_GAP = 0.34;
/** Насколько далеко вперёд по маршруту машина смотрит на другие машины. */
const LOOK_AHEAD = 0.9;
/** Машина ближе этого к точке маршрута - помеха; встречная полоса дальше (2 * CAR_LANE). */
const CAR_RADIUS = 0.2;
/** Поворачивая налево, пропускаем встречных, которые ближе этого к центру перекрёстка. */
const YIELD_RANGE = 1.7;
/** Где ждать встречных: у въезда на перекрёсток, чуть не доезжая до его центра. */
const YIELD_GAP = 0.45;
/** Предохранитель от затора, где машины ждут друг друга по кругу: потом едем. */
const JAM_LIMIT = 20;

const CAR_MODELS: ModelName[] = ['car_hatchback', 'car_sedan', 'car_stationwagon', 'car_taxi', 'car_police'];
const TAXI = 3, POLICE = 4, TRUCK = CAR_MODELS.length;

/** Поворот модели KayKit, чтобы капот смотрел по ходу движения (+z). */
const CAR_YAW = 0;

/** Часы суток 0..24 -> часы от начала игровых суток 6..30. */
const sinceStart = (hour: number) => (hour < DAY_START_HOUR ? hour + 24 : hour);

/** Машина на улице, а не у бордюра: первый отрезок - выезд от бордюра, последний - парковка. */
const onStreet = (c: Car) => c.seg >= 1 && c.seg <= c.pts.length / 2 - 3;

const rand = Math.random;
const between = (a: number, b: number) => a + rand() * (b - a);
const chance = (p: number) => rand() < p;

/** Взвешенный случайный выбор: жилой дом на 40 жителей чаще, чем на 8. */
function pick(list: Place[]): Place | null {
  if (!list.length) return null;
  let total = 0;
  for (const p of list) total += p.weight;
  let r = rand() * total;
  for (const p of list) if ((r -= p.weight) <= 0) return p;
  return list[list.length - 1];
}

export class Traffic {
  readonly group = new THREE.Group();
  /** Кто стоит на зебре: спрашивают пешеходы (см. pedestrians.ts). */
  onCrossing: ((cell: number) => boolean) | null = null;
  /** Броневик отряда на клетке: машины его пропускают (см. wastelandView.ts). */
  onConvoy: ((cell: number) => boolean) | null = null;
  private meshes: THREE.InstancedMesh[] = [];
  private lights: THREE.InstancedMesh;
  private lightMat: THREE.MeshBasicMaterial;
  private agents: Agent[] = [];
  private cars: Car[] = [];
  private dayIndex = -1;
  private nextId = 0;
  /** Машины по клеткам на этот кадр: соседей ищем только рядом. */
  private grid = new Map<number, Car[]>();
  private pos = new Map<Car, [number, number]>();
  private tmp = new THREE.Object3D();
  private now = DAY_START_HOUR;

  constructor(private map: CityMap, private maxCars: number) {
    const material = new THREE.MeshLambertMaterial({ vertexColors: true });
    // Высота асфальта - по центру дорожной модели, чтобы колёса стояли на полотне
    const top = roadTop();
    const geos = CAR_MODELS.map((name) => {
      const g = new GeoBuilder();
      g.model(MODELS[name], 0, top + WHEEL_DROP * CAR_SCALE, 0, CAR_SCALE);
      return g.build();
    });
    geos.push(truckGeometry(top));
    for (const geo of geos) {
      const m = new THREE.InstancedMesh(geo, material, maxCars);
      m.count = 0;
      m.castShadow = true;
      m.frustumCulled = false;
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.meshes.push(m);
      this.group.add(m);
    }
    // Ночью перед машиной на асфальте - пятно света фар
    this.lightMat = new THREE.MeshBasicMaterial({ color: 0xffe2a0, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending });
    const pool = new THREE.CircleGeometry(0.1, 10).rotateX(-Math.PI / 2).scale(1, 1, 1.8).translate(0, top + 0.01, 0.24);
    this.lights = new THREE.InstancedMesh(pool, this.lightMat, maxCars);
    this.lights.count = 0;
    this.lights.frustumCulled = false;
    this.lights.userData.noOutline = true;
    this.group.add(this.lights);
  }

  /** Новый мир (загрузка, новая игра): все машины и семьи заново. */
  reset() {
    this.cars = [];
    this.agents = [];
    this.dayIndex = -1;
  }

  /** Набор мест изменился (новый город): семьи и службы собираются заново. */
  repopulate() {
    this.populate();
  }

  /** hour - время видимых суток 0..24, day - их номер, dark - насколько темно 0..1 (фары). */
  update(w: World, hour: number, day: number, dark: number, dt: number) {
    this.group.visible = !w.mission;
    this.now = sinceStart(hour);
    if (day !== this.dayIndex) {
      // Новые сутки: у каждого свой план на день
      if (this.dayIndex >= 0) for (const a of this.agents) this.plan(a, DAY_START_HOUR);
      this.dayIndex = day;
    }
    const factor = w.over ? 0 : SPEED_FACTOR[w.speed];
    if (factor > 0) {
      this.depart();
      this.drive(dt * SPEED * Math.pow(factor, SPEED_POWER), dt);
    }
    this.draw(dark);
  }

  /**
   * Где машине останавливаться: перед зеброй с людьми, перед своим красным, у въезда
   * на перекрёсток при повороте налево (пропустить встречных) и за другой машиной.
   * Пешеходы на переходе главнее светофора: машина стоит, даже если ей зелёный.
   */
  private stopAhead(car: Car): { dist: number; kind: StopKind } {
    const p = car.pts;
    const size = this.map.size;
    const segLen = (j: number) => Math.hypot(p[j * 2 + 2] - p[j * 2], p[j * 2 + 3] - p[j * 2 + 1]);
    /** Ось улицы, по которой машина едет на отрезке к клетке k: 0 - вдоль x, 1 - вдоль z. */
    const axisTo = (k: number): 0 | 1 => {
      const i = Math.max(0, k - 1);
      const a = car.path[i], b = car.path[Math.min(car.path.length - 1, i + 1)];
      return a % size !== b % size ? 0 : 1;
    };
    let best = this.carAhead(car);
    let ahead = car.seg < car.path.length ? Math.max(0, segLen(car.seg) - car.t) : Infinity;
    for (let k = car.seg; k < Math.min(car.path.length, car.seg + 3); k++) {
      if (k > car.seg) ahead += segLen(k);
      if (ahead - STOP_GAP >= best.dist) break;
      const cell = car.path[k];
      if (k > car.seg && this.onConvoy && this.onConvoy(cell)) return { dist: Math.max(0, ahead - STOP_GAP), kind: 'yield' };
      if (this.map.crossings.has(cell) && this.onCrossing && this.onCrossing(cell)) {
        return { dist: Math.max(0, ahead - STOP_GAP), kind: 'people' };
      }
      // Стоп-линия уже позади: машина заехала и проезжает, даже если загорелся жёлтый
      if (ahead >= STOP_GAP && this.redAhead(car, k, axisTo)) return { dist: ahead - STOP_GAP, kind: 'light' };
      if (ahead >= YIELD_GAP && this.mustYield(car, k, ahead)) best = { dist: ahead - YIELD_GAP, kind: 'yield' };
    }
    return best;
  }

  /**
   * Горит ли красный перед клеткой k: только светофор на въезде в перекрёсток, по оси своей улицы.
   * Зебра на выезде и поворот на поперечную улицу машину не держат.
   */
  private redAhead(car: Car, k: number, axisTo: (k: number) => 0 | 1): boolean {
    const cell = car.path[k];
    const axis = this.map.crossAxis.get(cell);
    if (axis === undefined || axis !== axisTo(k)) return false;
    if (k + 1 >= car.path.length || !this.map.isJunction(car.path[k + 1])) return false;
    return this.map.light(axis) !== 'green';
  }

  /** Направление шага по клеткам пути: [dx, dz]. */
  private dirOf(path: number[], i: number): [number, number] {
    const s = this.map.size;
    return [(path[i + 1] % s) - (path[i] % s), Math.floor(path[i + 1] / s) - Math.floor(path[i] / s)];
  }

  /** Поворачивает ли машина налево на клетке k пути (движение правостороннее). */
  private turnsLeft(path: number[], k: number): boolean {
    if (k < 1 || k + 1 >= path.length) return false;
    const [ix, iz] = this.dirOf(path, k - 1), [ox, oz] = this.dirOf(path, k);
    // Левая сторона по ходу (x, z) - это (dz, -dx): справа (-dz, dx), см. cityMap.route
    return ox === iz && oz === -ix;
  }

  /**
   * Поворот налево на перекрёстке k: уступить встречным, которые едут прямо или направо.
   * Две встречные, обе налево, разъезжаются по очереди: первой - та, что ближе (mine - наш путь до центра).
   */
  private mustYield(car: Car, k: number, mine: number): boolean {
    const cell = car.path[k];
    if (!this.map.isJunction(cell) || !this.turnsLeft(car.path, k)) return false;
    const [ix, iz] = this.dirOf(car.path, k - 1);
    for (const o of this.cars) {
      if (o === car || o.blocked > 0.5) continue;
      const m = o.path.indexOf(cell, Math.max(1, o.seg));
      if (m < 1) continue;
      const [ox, oz] = this.dirOf(o.path, m - 1);
      if (ox !== -ix || oz !== -iz) continue;
      const q = o.pts;
      let d = Math.hypot(q[o.seg * 2 + 2] - q[o.seg * 2], q[o.seg * 2 + 3] - q[o.seg * 2 + 1]) - o.t;
      for (let j = o.seg + 1; j <= m && d < YIELD_RANGE; j++) d += Math.hypot(q[j * 2 + 2] - q[j * 2], q[j * 2 + 3] - q[j * 2 + 1]);
      if (d >= YIELD_RANGE) continue;
      if (!this.turnsLeft(o.path, m) || d < mine || (d === mine && o.id < car.id)) return true;
    }
    return false;
  }

  /** Ближайшая машина на своём пути впереди: идём по маршруту и смотрим, кто рядом с ним. */
  private carAhead(car: Car): { dist: number; kind: StopKind } {
    const p = car.pts;
    const last = p.length / 2 - 1;
    const [cx, cz] = this.pos.get(car)!;
    const size = this.map.size;
    const near = (x: number, z: number, r: number, test: (o: Car, d: number) => boolean): Car | null => {
      const gx = Math.floor(x), gz = Math.floor(z);
      for (let ox = -1; ox <= 1; ox++) {
        for (let oz = -1; oz <= 1; oz++) {
          const list = this.grid.get((gz + oz) * size + gx + ox);
          if (!list) continue;
          for (const o of list) {
            // У бордюра машины паркуются рядом друг с другом и полосу не загораживают
            if (o === car || !onStreet(o)) continue;
            const [px, pz] = this.pos.get(o)!;
            const d = Math.hypot(px - x, pz - z);
            if (d <= r && test(o, d)) return o;
          }
        }
      }
      return null;
    };
    // Слиплись (выехали в одну точку): старшая отъезжает, младшая ждёт
    const twin = onStreet(car) ? near(cx, cz, FOLLOW_GAP * 0.6, (o) => o.id < car.id) : null;
    if (twin) {
      car.blocker = twin;
      return { dist: 0, kind: 'car' };
    }
    // Выезд от бордюра на полосу: пропустить тех, кто едет по ней
    if (car.seg === 0 && p.length >= 4) {
      const other = near(p[2], p[3], 0.6, () => true);
      if (other) {
        car.blocker = other;
        return { dist: 0, kind: 'car' };
      }
    }
    let seg = car.seg, t = car.t, d = 0;
    const STEP = 0.08;
    // Первая проверка - у переднего бампера: свою же позицию за помеху не считаем
    for (let along = STEP * 2; along <= LOOK_AHEAD; along += STEP) {
      let left = along - d;
      while (left > 0 && seg < last) {
        const len = Math.hypot(p[seg * 2 + 2] - p[seg * 2], p[seg * 2 + 3] - p[seg * 2 + 1]);
        const step = Math.min(left, len - t);
        t += step;
        left -= step;
        d += step;
        if (t >= len - 1e-6) {
          seg++;
          t = 0;
        }
      }
      if (seg >= last && left > 0) break;
      const i = seg * 2;
      const len = Math.hypot(p[i + 2] - p[i], p[i + 3] - p[i + 1]) || 1;
      const x = p[i] + ((p[i + 2] - p[i]) * t) / len, z = p[i + 1] + ((p[i + 3] - p[i + 1]) * t) / len;
      const o = near(x, z, CAR_RADIUS, (o) => {
        // Слипшуюся с нами машину разбирает правило выше
        if (Math.hypot(this.pos.get(o)![0] - cx, this.pos.get(o)![1] - cz) < FOLLOW_GAP * 0.6) return false;
        // Две машины ждут друг друга: младшая едет, старшая стоит
        return !(o.blocker === car && car.id < o.id);
      });
      if (o) {
        car.blocker = o;
        return { dist: Math.max(0, along - FOLLOW_GAP), kind: 'car' };
      }
    }
    return { dist: Infinity, kind: 'none' };
  }

  /** Положение машины на маршруте. */
  private carPos(car: Car): [number, number] {
    const p = car.pts;
    const last = p.length / 2 - 1;
    if (car.seg >= last) return [p[p.length - 2], p[p.length - 1]];
    const i = car.seg * 2;
    const len = Math.hypot(p[i + 2] - p[i], p[i + 3] - p[i + 1]) || 1;
    const k = car.t / len;
    return [p[i] + (p[i + 2] - p[i]) * k, p[i + 1] + (p[i + 3] - p[i + 1]) * k];
  }

  /** Машины на улицах для рисованных спрайтов (?sprites, sprites/spriteLayer.ts): model 0..4 - легковые, 5 - фургон. */
  *vehicles(): Generator<{ x: number; z: number; yaw: number; model: number }> {
    for (const car of this.cars) {
      const [x, z] = this.carPos(car);
      yield { x, z, yaw: car.yaw, model: car.agent.model };
    }
  }

  /** Свободен ли переход: рядом с ним нет машин (пешеход решает, шагать ли на зебру). */
  crossingClear(cell: number): boolean {
    const s = this.map.size;
    const cx = (cell % s) + 0.5, cz = Math.floor(cell / s) + 0.5;
    for (const car of this.cars) {
      const [x, z] = this.carPos(car);
      if (Math.hypot(x - cx, z - cz) < 2.2) return false;
    }
    return true;
  }

  /** Сколько машин и у кого: семьи по числу жителей, грузовики по промзонам и фермам, такси и полиция. */
  private populate() {
    this.agents = [];
    const people = this.map.homes.reduce((sum, p) => sum + p.weight, 0);
    const jobSlots = this.map.jobs.reduce((sum, p) => sum + p.weight, 0);
    const families = Math.min(Math.ceil(people / PEOPLE_PER_CAR), this.maxCars * 2);
    // Работы на всех может не хватать: безработные днём ездят по магазинам
    const employed = people ? Math.min(1, jobSlots / people) : 0;
    for (let i = 0; i < families; i++) {
      const home = pick(this.map.homes)!;
      const work = chance(employed) ? pick(this.map.jobs) : null;
      const school = chance(0.4) ? this.nearest(this.map.schools, home) : null;
      this.agents.push({ home, work, school, kind: 'family', model: Math.floor(rand() * TAXI), at: home, plan: [], wait: 0, car: null });
    }
    const trucks = Math.min(this.map.farms.length, Math.ceil(this.map.farms.length / 3));
    for (let i = 0; i < trucks && this.map.shops.length; i++) {
      const home = pick(this.map.farms)!;
      this.agents.push({ home, work: null, school: null, kind: 'truck', model: TRUCK, at: home, plan: [], wait: 0, car: null });
    }
    const service = (kind: 'taxi' | 'police', count: number, model: number) => {
      for (let i = 0; i < count; i++) {
        const home = pick(this.map.jobs.length ? this.map.jobs : this.map.homes);
        if (home) this.agents.push({ home, work: null, school: null, kind, model, at: home, plan: [], wait: 0, car: null });
      }
    };
    service('taxi', Math.min(6, Math.floor(people / 150)), TAXI);
    service('police', Math.min(3, Math.floor(people / 300)), POLICE);
    // Посреди дня: кто должен быть на работе - уже там, план только на оставшиеся часы
    for (const a of this.agents) {
      if (a.work && this.now > 9.5 && this.now < 16.5) a.at = a.work;
      this.plan(a, this.now);
    }
  }

  private nearest(list: Place[], from: Place): Place | null {
    let best: Place | null = null, bestD = Infinity;
    for (const p of list) {
      const d = Math.hypot(p.x - from.x, p.z - from.z);
      if (d < bestD) { bestD = d; best = p; }
    }
    return best;
  }

  /** Распорядок на сутки; поездки раньше from (уже прошедшие часы) не попадают. */
  private plan(a: Agent, from: number) {
    const trips: Trip[] = [];
    const go = (hour: number, to: Place | null) => { if (to) trips.push({ hour, to }); };
    const shop = () => pick(this.map.shops);
    switch (a.kind) {
      case 'family': {
        if (a.work) {
          const leave = between(6.8, 8.6);
          // Сначала отвезти детей в школу, оттуда - на работу
          if (a.school) go(Math.min(leave, 7.8), a.school);
          go(leave, a.work);
          if (chance(0.2)) {
            go(between(12, 13), shop());
            go(13.2, a.work);
          }
          const back = between(16.6, 19.2);
          if (chance(0.35)) go(back, shop());
          go(back, a.home);
          if (chance(0.15)) {
            go(between(19.5, 21.5), shop());
            go(21.6, a.home);
          }
        } else {
          // Без работы: утром дети в школу и назад, днём магазины, после уроков - забрать детей
          if (a.school) {
            go(between(7, 7.8), a.school);
            go(7.9, a.home);
          }
          if (chance(0.7)) {
            go(between(9.5, 13), shop());
            go(between(13, 14), a.home);
          }
          if (a.school) {
            go(between(14.5, 15.5), a.school);
            go(15.6, a.home);
          }
          if (chance(0.4)) {
            go(between(17.5, 20.5), shop());
            go(21, a.home);
          }
        }
        break;
      }
      case 'truck': {
        // Развоз товара с утра до вечера: склад - магазин - склад
        for (let h = between(6, 8); h < 19; h += between(2.5, 4)) {
          go(h, shop());
          go(h + 0.5, a.home);
        }
        break;
      }
      case 'taxi': {
        // Такси возит людей весь вечер и ночь, днём стоит
        for (let h = between(18, 19.5); h < 29; h += between(0.8, 1.8)) go(h, chance(0.5) ? pick(this.map.homes) : pick(this.map.jobs));
        break;
      }
      case 'police': {
        for (let h = between(6, 8); h < 30; h += between(1.5, 3)) go(h, chance(0.5) ? pick(this.map.homes) : pick(this.map.jobs));
        break;
      }
    }
    trips.sort((x, y) => x.hour - y.hour);
    a.plan = trips.filter((t) => t.hour >= from);
    a.wait = 0;
  }

  /** Отправить в путь всех, чьё время пришло и кто не в дороге. */
  private depart() {
    for (const a of this.agents) {
      if (a.car || !a.plan.length || a.plan[0].hour > this.now || a.wait > this.now) continue;
      const trip = a.plan.shift()!;
      if (trip.to === a.at) continue;
      const path = this.cars.length < this.maxCars ? this.map.path(a.at.road, trip.to.road) : null;
      if (!path) {
        // Нет дороги или улицы забиты - считаем, что доехал другим путём
        a.at = trip.to;
        continue;
      }
      const car: Car = { id: this.nextId++, agent: a, to: trip.to, path, pts: this.map.driveRoute(path, a.at, trip.to), seg: 0, t: 0, yaw: 0, blocked: 0, blocker: null };
      car.yaw = Math.atan2(car.pts[2] - car.pts[0], car.pts[3] - car.pts[1]);
      a.car = car;
      this.cars.push(car);
    }
  }

  private drive(dist: number, dt: number) {
    const done: Car[] = [];
    this.grid.clear();
    this.pos.clear();
    const size = this.map.size;
    for (const car of this.cars) {
      const at = this.carPos(car);
      this.pos.set(car, at);
      const key = Math.floor(at[1]) * size + Math.floor(at[0]);
      const list = this.grid.get(key);
      if (list) list.push(car);
      else this.grid.set(key, [car]);
    }
    for (const car of this.cars) {
      car.blocker = null;
      const gate = this.stopAhead(car);
      // Встали не из-за машины (светофор, люди ближе неё) - никого не держим за помеху
      if (gate.kind !== 'car') car.blocker = null;
      if (gate.dist <= 0) {
        car.blocked += dt;
        // Предохранитель: перед человеком стоим не дольше STUCK_LIMIT, перед красным - дольше,
        // иначе машины ездили бы на красный всю фазу; затор по кругу разъезжается через JAM_LIMIT
        const limit = gate.kind === 'light' ? RED_LIMIT : gate.kind === 'people' ? STUCK_LIMIT : JAM_LIMIT;
        if (car.blocked < limit) continue;
      } else car.blocked = 0;
      let left = car.blocked > 0 ? dist : Math.min(dist, gate.dist);
      const p = car.pts;
      while (left > 0 && car.seg < p.length / 2 - 1) {
        const i = car.seg * 2;
        const len = Math.hypot(p[i + 2] - p[i], p[i + 3] - p[i + 1]);
        const step = Math.min(left, len - car.t);
        car.t += step;
        left -= step;
        if (car.t >= len - 1e-6) {
          car.seg++;
          car.t = 0;
        }
      }
      if (car.seg >= p.length / 2 - 1) done.push(car);
      // Поворот плавный: машина доворачивает к направлению отрезка
      const i = Math.min(car.seg, p.length / 2 - 2) * 2;
      const target = Math.atan2(p[i + 2] - p[i], p[i + 3] - p[i + 1]);
      let diff = target - car.yaw;
      diff = Math.atan2(Math.sin(diff), Math.cos(diff));
      car.yaw += diff * Math.min(1, dt * 14);
    }
    for (const car of done) {
      const a = car.agent;
      a.car = null;
      a.at = car.to;
      // Стоянка: в магазине побыть, у школы - только высадить детей
      a.wait = this.now + (this.map.shops.includes(car.to) ? between(0.5, 1) : 0.15);
      this.cars.splice(this.cars.indexOf(car), 1);
    }
  }

  private draw(dark: number) {
    const counts = new Array(this.meshes.length).fill(0);
    let lit = 0;
    const showLights = dark > 0.2;
    this.lightMat.opacity = Math.min(1, (dark - 0.2) * 1.6) * 0.75;
    for (const car of this.cars) {
      const [x, z] = this.carPos(car);
      this.tmp.position.set(x, 0, z);
      this.tmp.rotation.set(0, car.yaw + CAR_YAW, 0);
      this.tmp.updateMatrix();
      const m = car.agent.model;
      this.meshes[m].setMatrixAt(counts[m]++, this.tmp.matrix);
      if (showLights) {
        this.tmp.rotation.set(0, car.yaw, 0);
        this.tmp.updateMatrix();
        this.lights.setMatrixAt(lit++, this.tmp.matrix);
      }
    }
    this.meshes.forEach((mesh, k) => {
      mesh.count = counts[k];
      mesh.instanceMatrix.needsUpdate = true;
    });
    this.lights.count = lit;
    this.lights.instanceMatrix.needsUpdate = true;
  }
}

/** Грузовик-фургон: кабина и кузов коробками в стиле процедурных зданий; капот к +z. */
function truckGeometry(top: number): THREE.BufferGeometry {
  const g = new GeoBuilder();
  const y = top + 0.03;
  // Колёса - тёмные бруски под кузовом
  g.box(0, top, 0.09, 0.15, 0.035, 0.05, 0x2b2622);
  g.box(0, top, -0.09, 0.15, 0.035, 0.05, 0x2b2622);
  g.box(0, y, -0.035, 0.14, 0.13, 0.2, 0xd9cbb0, 0, 0xe6dac2); // кузов
  g.box(0, y, 0.115, 0.13, 0.09, 0.08, 0xb5643a, 0, 0xa0522d); // кабина
  g.box(0, y + 0.05, 0.156, 0.11, 0.03, 0.002, 0x3e3a37); // лобовое стекло
  return g.build();
}
