// Машины на улицах живут по распорядку дня: утром родители везут детей в школу и едут на работу,
// в обед и вечером заезжают в магазины, после работы возвращаются домой; грузовики возят товар
// с промзон и ферм в торговлю, ночью по городу ездят такси и полиция.
// Только вид: на симуляцию не влияет, расписание строится заново каждые игровые сутки.
// Где входы зданий, как проложить путь и где зебры - знает план улиц (cityMap.ts).

import * as THREE from 'three';
import { DIRS, SPEED_FACTOR, type World } from '@avi/sim';
import { CYCLE_START_HOUR as DAY_START_HOUR } from './dayCycle';
import { CityMap, roadTop, type Place } from './cityMap';
import { GeoBuilder } from './builder';
import { driveLane, type Lane } from './lanes';
import { ambulanceGeometry, busGeometry, dumpGeometry, pickupGeometry, shelterGeometry, vanGeometry } from './vehicles';
import { MODELS, type ModelName } from './models';

/** hour - час от начала игровых суток: 6..30, ночь после полуночи - 24..30. */
interface Trip { hour: number; to: Place }

/** Семья (или служба) со своей машиной: где она сейчас и куда поедет сегодня. */
interface Agent {
  home: Place;
  work: Place | null;
  school: Place | null;
  kind: 'family' | 'truck' | 'dump' | 'taxi' | 'police' | 'ambulance' | 'bus';
  model: number;
  at: Place;
  plan: Trip[];
  /** Не выезжать раньше этого часа (6..30): стоянка у школы, в магазине. */
  wait: number;
  car: Car | null;
  /** Своё место у бордюра: сдвиг вдоль фасада, чтобы машины одного дома не вставали в одну точку. */
  slot: number;
  /** Остановки автобуса по кругу. */
  stops?: Place[];
}

interface Car {
  /** Порядковый номер: из двух машин, мешающих друг другу, первой едет младшая. */
  id: number;
  agent: Agent;
  to: Place;
  /** Клетки дорог по маршруту. */
  path: number[];
  /** Полоса по маршруту: дуги поворотов, выезд от бордюра и заезд к нему (lanes.ts). */
  lane: Lane;
  /** Пройдено по полосе и скорость (клеток в секунду игрового времени). */
  s: number;
  v: number;
  /** Отрезок полосы, на котором машина: точку ищем от него, а не с начала. */
  seg: number;
  yaw: number;
  /** Сколько секунд машина стоит, не имея возможности ехать. */
  blocked: number;
  /** Машина, за которой стоим в этом кадре: по ней разбираем взаимные помехи. */
  blocker: Car | null;
  /** Тормозит или стоит на тормозе - горят стоп-сигналы. */
  brake: boolean;
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
/** Разгон и спокойное торможение, клеток/с²: с полной скорости машина встаёт за ~0.3 клетки. */
const ACCEL = 0.9;
const BRAKE = 1.6;
/** Насколько далеко вперёд машина видит повороты, чтобы заранее сбросить скорость. */
const BEND_AHEAD = 1.5;
/** Столько жителей на одну машину. */
const PEOPLE_PER_CAR = 7;
/** Шаг мест у бордюра вдоль фасада: длина машины и зазор. */
const SLOT = 0.27;
/** Перед зеброй машина останавливается, не доезжая до неё: полклетки - это и есть полоса перехода. */
const STOP_GAP = 0.46;
/** Машина у самой стоп-линии ещё перед ней: на неточность шага. */
const LINE_SLACK = 0.02;
/**
 * Предохранитель от вечного затора перед человеком на зебре: пешеход главнее машины, она ждёт,
 * пока он перейдёт, и едет дальше, только если что-то сломалось и человек стоит на переходе.
 */
const STUCK_LIMIT = 40;
/** Красный свет горит дольше предохранителя людей: на светофоре ждать можно, но не вечно. */
const RED_LIMIT = 18;
/** Расстояние между центрами легковых в пробке: длина машины ~0.25 и зазор. */
const FOLLOW_GAP = 0.34;
/** Зазор между бамперами в пробке. */
const BUMPER_GAP = 0.09;
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
const VAN = TRUCK + 1, PICKUP = TRUCK + 2, DUMP = TRUCK + 3, BUS = TRUCK + 4, AMBULANCE = TRUCK + 5;
/** Длина кузова по номеру модели: от неё дистанция в пробке. */
const LENGTH = [0.25, 0.25, 0.25, 0.25, 0.25, 0.3, 0.28, 0.3, 0.33, 0.5, 0.28];
/** Машина семьи: чаще легковые KayKit, иногда фургон или пикап. */
const FAMILY_MODELS = [0, 0, 1, 1, 2, 2, VAN, PICKUP];
/** Остановок на маршруте автобуса и сколько он стоит на каждой (часов). */
const BUS_STOPS = 5;
const BUS_DWELL = 0.1;
/**
 * Стоянка у бордюра: точка места (Place) - посреди тротуара, сдвигаем к оси дороги до 0.28 -
 * машина стоит у самого бордюра, краем на нём (полоса движения в 0.13, ширина машины 0.12).
 */
const PARK_IN = 0.14;

/** Поворот модели KayKit, чтобы капот смотрел по ходу движения (+z). */
const CAR_YAW = 0;

/** Часы суток 0..24 -> часы от начала игровых суток 6..30. */
const sinceStart = (hour: number) => (hour < DAY_START_HOUR ? hour + 24 : hour);

/** Машина на улице, а не у бордюра: уже тронулась и ещё не съехала с полосы к бордюру (80% заезда). */
const onStreet = (c: Car) => c.s > 0.02 && c.s < c.lane.park + (c.lane.len[c.lane.len.length - 1] - c.lane.park) * 0.8;

/** Тормозной путь со скорости v. */
const brakeDist = (v: number) => (v * v) / (2 * BRAKE);

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
  onCrossing: ((cell: number) => 'walk' | 'wait' | null) | null = null;
  /** Броневик отряда на клетке: машины его пропускают (см. wastelandView.ts). */
  onConvoy: ((cell: number) => boolean) | null = null;
  private meshes: THREE.InstancedMesh[] = [];
  private lights: THREE.InstancedMesh;
  private tails: THREE.InstancedMesh;
  private tailColor = new THREE.Color();
  private shelters: THREE.InstancedMesh;
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
    geos.push(truckGeometry(top), vanGeometry(top), pickupGeometry(top), dumpGeometry(top), busGeometry(top), ambulanceGeometry(top));
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
    // Задние огни: ночью тусклые габариты, при торможении - яркие стоп-сигналы (цвет на машину)
    const tail = new GeoBuilder();
    for (const e of [-1, 1]) tail.box(e * 0.038, top + 0.03, 0, 0.02, 0.012, 0.006, 0xffffff);
    this.tails = new THREE.InstancedMesh(tail.build(), new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false }), maxCars);
    this.tails.count = 0;
    this.tails.frustumCulled = false;
    this.tails.userData.noOutline = true;
    this.group.add(this.tails);
    // Павильоны автобусных остановок на тротуаре: ставятся вместе с маршрутами (populate)
    this.shelters = new THREE.InstancedMesh(shelterGeometry(top + 0.015), material, 32);
    this.shelters.count = 0;
    this.shelters.castShadow = true;
    this.group.add(this.shelters);
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
      this.drive(dt * Math.pow(factor, SPEED_POWER), dt);
    }
    this.draw(dark);
  }

  /**
   * Где машине останавливаться: перед зеброй с людьми, перед своим красным, у въезда
   * на перекрёсток при повороте налево (пропустить встречных) и за другой машиной.
   * Пешеходы на переходе главнее светофора: машина стоит, даже если ей зелёный.
   * dist - сколько ещё можно проехать до точки остановки.
   */
  private stopAhead(car: Car): { dist: number; kind: StopKind } {
    const marks = car.lane.marks;
    const size = this.map.size;
    /** Ось улицы, по которой машина едет к клетке k: 0 - вдоль x, 1 - вдоль z. */
    const axisTo = (k: number): 0 | 1 => {
      const i = Math.max(0, k - 1);
      const a = car.path[i], b = car.path[Math.min(car.path.length - 1, i + 1)];
      return a % size !== b % size ? 0 : 1;
    };
    let best = this.carAhead(car);
    const k0 = this.cellIndex(car);
    for (let k = k0; k < Math.min(car.path.length, k0 + 3); k++) {
      const ahead = marks[k] - car.s;
      if (ahead - STOP_GAP >= best.dist) break;
      // Стоп-линия уже позади: машина заехала и проезжает перекрёсток или переход
      const before = ahead > STOP_GAP - LINE_SLACK;
      const gap = Math.max(0, ahead - STOP_GAP);
      const cell = car.path[k];
      if (k > k0 && this.onConvoy && this.onConvoy(cell)) return { dist: gap, kind: 'yield' };
      // Человек идёт по зебре - стоим всегда; ждёт у края - пропускаем, если успеваем затормозить
      // (если нет - он и не шагнёт, пока мы рядом: crossingClear)
      const people = before && this.map.crossings.has(cell) && this.onCrossing ? this.onCrossing(cell) : null;
      if (people === 'walk' || (people === 'wait' && brakeDist(car.v) <= gap + 0.05)) return { dist: gap, kind: 'people' };
      const light = before ? this.lightAhead(car, k, axisTo) : 'green';
      // На жёлтый едет тот, кто уже не успевает спокойно встать; на красный - кто не встанет
      // и резким торможением (въехал на жёлтый): перекрёсток после жёлтого ещё ALL_RED для всех
      if ((light === 'red' && brakeDist(car.v) <= gap * 2 + 0.05) || (light === 'yellow' && brakeDist(car.v) <= gap)) return { dist: gap, kind: 'light' };
      if (ahead > YIELD_GAP - LINE_SLACK && this.mustYield(car, k, ahead)) best = { dist: Math.max(0, ahead - YIELD_GAP), kind: 'yield' };
    }
    return best;
  }

  /**
   * Свет перед клеткой k: только светофор на въезде в перекрёсток, по оси своей улицы.
   * Зебра на выезде и поворот на поперечную улицу машину не держат.
   */
  private lightAhead(car: Car, k: number, axisTo: (k: number) => 0 | 1): 'green' | 'yellow' | 'red' {
    const cell = car.path[k];
    const axis = this.map.crossAxis.get(cell);
    if (axis === undefined || axis !== axisTo(k)) return 'green';
    if (k + 1 >= car.path.length || !this.map.isJunction(car.path[k + 1])) return 'green';
    return this.map.light(axis);
  }

  /** Номер клетки маршрута, к середине которой машина едет (у которой ещё не проехала середину). */
  private cellIndex(car: Car): number {
    const marks = car.lane.marks;
    let k = 0;
    while (k < marks.length && marks[k] <= car.s) k++;
    return k;
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
    if (!this.map.isJunction(cell) || k < 1) return false;
    if (!this.map.crossAxis.has(car.path[k - 1]) && this.rightOfWay(car, k, mine)) return true;
    if (!this.turnsLeft(car.path, k)) return false;
    const [ix, iz] = this.dirOf(car.path, k - 1);
    for (const o of this.cars) {
      if (o === car || o.blocked > 0.5) continue;
      const m = o.path.indexOf(cell, Math.max(1, this.cellIndex(o)));
      if (m < 1) continue;
      const [ox, oz] = this.dirOf(o.path, m - 1);
      if (ox !== -ix || oz !== -iz) continue;
      const d = o.lane.marks[m] - o.s;
      if (d >= YIELD_RANGE) continue;
      if (!this.turnsLeft(o.path, m) || d < mine || (d === mine && o.id < car.id)) return true;
    }
    return false;
  }

  /**
   * Перекрёсток k без светофора на нашем въезде: помеха справа. Уступаем тем, кто подъезжает справа
   * ближе нас, и тем, кто уже въехал (ближе YIELD_GAP к центру) с поперечной улицы.
   * Затор, когда все ждут всех, разъезжается предохранителем JAM_LIMIT.
   */
  private rightOfWay(car: Car, k: number, mine: number): boolean {
    const cell = car.path[k];
    const [ix, iz] = this.dirOf(car.path, k - 1);
    for (const o of this.cars) {
      if (o === car || o.blocked > 0.5) continue;
      const m = o.path.indexOf(cell, Math.max(1, this.cellIndex(o) - 1));
      if (m < 1) continue;
      const d = o.lane.marks[m] - o.s;
      if (d >= YIELD_RANGE || d < -0.4) continue;
      const [ox, oz] = this.dirOf(o.path, m - 1);
      // Поперёк нас: справа едет в сторону (iz, -ix), слева - (-iz, ix)
      const fromRight = ox === iz && oz === -ix;
      const across = fromRight || (ox === -iz && oz === ix);
      if (!across) continue;
      if (d < YIELD_GAP - 0.05) return true;
      if (fromRight && (d < mine || (d === mine && o.id < car.id))) return true;
    }
    return false;
  }

  /** Ближайшая машина на своём пути впереди: идём по полосе и смотрим, кто рядом с ней. */
  private carAhead(car: Car): { dist: number; kind: StopKind } {
    const lane = car.lane;
    const end = lane.len[lane.len.length - 1];
    const [cx, cz] = this.pos.get(car)!;
    const size = this.map.size;
    /** Машина рядом с точкой; curb - считать и тех, кто стоит у бордюра. */
    const near = (x: number, z: number, r: number, test: (o: Car, d: number) => boolean, curb = false): Car | null => {
      const gx = Math.floor(x), gz = Math.floor(z);
      for (let ox = -1; ox <= 1; ox++) {
        for (let oz = -1; oz <= 1; oz++) {
          const list = this.grid.get((gz + oz) * size + gx + ox);
          if (!list) continue;
          for (const o of list) {
            // У бордюра машины паркуются рядом друг с другом и полосу не загораживают
            if (o === car || (!curb && !onStreet(o))) continue;
            const [px, pz] = this.pos.get(o)!;
            const d = Math.hypot(px - x, pz - z);
            if (d <= r && test(o, d)) return o;
          }
        }
      }
      return null;
    };
    /** Куда смотрит капот. */
    const hx = Math.sin(car.yaw), hz = Math.cos(car.yaw);
    const wait = (o: Car) => {
      car.blocker = o;
      return { dist: 0, kind: 'car' as StopKind };
    };
    // Слиплись (выехали в одну точку): старшая отъезжает, младшая ждёт
    const twin = onStreet(car) ? near(cx, cz, FOLLOW_GAP * 0.6, (o) => o.id < car.id) : null;
    if (twin) return wait(twin);
    if (car.s <= 0.02) {
      // У бордюра ждут выезда несколько: первой уезжает та, что впереди по ходу (иначе проедем
      // сквозь неё), на одном месте - старшая
      const first = near(cx, cz, 0.6, (o, d) => {
        if (o.s > 0.02) return false;
        const [px, pz] = this.pos.get(o)!;
        return d < 0.25 ? o.id < car.id : (px - cx) * hx + (pz - cz) * hz > 0.05;
      }, true);
      if (first) return wait(first);
      // И никто не стоит у бордюра на пути выезда
      for (let d = 0.1; d < lane.merge; d += 0.1) {
        const [x, z] = this.pointAt(car, d);
        const parked = near(x, z, 0.2, (o) => o.s <= 0.02, true);
        if (parked) return wait(parked);
      }
      // Тронуться, только если по улице у места выезда никто не едет: полоса позади
      // и впереди, обе стороны (выезд с дальнего бордюра пересекает встречную)
      const [mx, mz] = this.pointAt(car, lane.merge);
      const ux = mx - cx, uz = mz - cz;
      const ul = Math.hypot(ux, uz) || 1;
      // Назад - на 2.5 клетки: выезд идёт 2-3 секунды, едущий по полосе успеет подъехать
      for (let d = -0.6; d <= ul + 2.5; d += 0.3) {
        // Паркующуюся, которая ждёт наше место, не ждём: уезжаем и освобождаем его
        const other = near(mx - (ux / ul) * d, mz - (uz / ul) * d, 0.45, (o) => o.blocker !== car);
        if (other) return wait(other);
      }
    }
    // Помеха - только то, что впереди по ходу: на машину сзади не оглядываемся
    const STEP = 0.08;
    // Первая проверка - у переднего бампера: свою же позицию за помеху не считаем
    for (let along = STEP * 2; along <= LOOK_AHEAD && car.s + along <= end; along += STEP) {
      const [x, z] = this.pointAt(car, car.s + along);
      const o = near(x, z, CAR_RADIUS, (o) => {
        const [px, pz] = this.pos.get(o)!;
        if ((px - cx) * hx + (pz - cz) * hz <= 0.05) return false;
        // Слипшуюся с нами машину разбирает правило выше
        if (Math.hypot(px - cx, pz - cz) < FOLLOW_GAP * 0.6) return false;
        if (o.blocker !== car) return true;
        // Две машины ждут друг друга: первой едет выезжающая от бордюра (она уже на полосе),
        // из равных - младшая
        const merging = (c: Car) => c.s < c.lane.merge;
        if (merging(car) !== merging(o)) return !merging(car);
        return !(car.id < o.id);
      });
      if (o) {
        car.blocker = o;
        // Зазор между бамперами: длинному автобусу нужна дистанция больше
        const gap = (LENGTH[car.agent.model] + LENGTH[o.agent.model]) / 2 + BUMPER_GAP;
        const [px, pz] = this.pos.get(o)!;
        return { dist: Math.max(0, Math.min(along, Math.hypot(px - cx, pz - cz)) - gap), kind: 'car' };
      }
    }
    return { dist: Infinity, kind: 'none' };
  }

  /** Точка полосы на длине s от начала; s не меньше пройденного машиной. */
  private pointAt(car: Car, s: number): [number, number] {
    const { pts, len } = car.lane;
    let i = car.seg;
    while (i < len.length - 2 && len[i + 1] <= s) i++;
    if (i >= len.length - 1) return [pts[pts.length - 2], pts[pts.length - 1]];
    const k = Math.min(1, Math.max(0, (s - len[i]) / (len[i + 1] - len[i] || 1)));
    return [pts[i * 2] + (pts[i * 2 + 2] - pts[i * 2]) * k, pts[i * 2 + 1] + (pts[i * 2 + 3] - pts[i * 2 + 1]) * k];
  }

  /** Положение машины на маршруте. */
  private carPos(car: Car): [number, number] {
    return this.pointAt(car, car.s);
  }

  /** Самая низкая скорость, с которой можно подъезжать к поворотам впереди, чтобы пройти их спокойно. */
  private bendLimit(car: Car): number {
    const b = car.lane.bends;
    let limit = SPEED;
    for (let i = 0; i < b.length; i += 3) {
      if (b[i + 1] <= car.s || b[i] - car.s > BEND_AHEAD) continue;
      const v = b[i + 2] * SPEED;
      limit = Math.min(limit, b[i] <= car.s ? v : Math.sqrt(v * v + 2 * BRAKE * (b[i] - car.s)));
    }
    return limit;
  }

  /** Машины на улицах для рисованных спрайтов (?sprites, sprites/spriteLayer.ts): model 0..4 - легковые, 5 - фургон. */
  *vehicles(): Generator<{ x: number; z: number; yaw: number; model: number }> {
    for (const car of this.cars) {
      const [x, z] = this.carPos(car);
      yield { x, z, yaw: car.yaw, model: car.agent.model };
    }
  }

  /**
   * Можно ли человеку шагнуть на зебру: на ней нет машины и никто не подъезжает так близко,
   * что уже не успеет спокойно затормозить. Остальные машины его пропустят (stopAhead).
   */
  crossingClear(cell: number): boolean {
    for (const car of this.cars) {
      const k = car.path.indexOf(cell, Math.max(0, this.cellIndex(car) - 1));
      if (k < 0) continue;
      const ahead = car.lane.marks[k] - car.s;
      // Проехала переход целиком (полклетки и длина машины)
      if (ahead < -0.65) continue;
      if (ahead <= STOP_GAP - LINE_SLACK) return false;
      if (car.v > 0.05 && ahead - STOP_GAP < brakeDist(car.v) + 0.05) return false;
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
      const model = FAMILY_MODELS[Math.floor(rand() * FAMILY_MODELS.length)];
      this.agents.push({ home, work, school, kind: 'family', model, at: home, plan: [], wait: 0, car: null, slot: this.slot(home) });
    }
    const add = (kind: Agent['kind'], home: Place | null, model: number) => {
      if (home) this.agents.push({ home, work: null, school: null, kind, model, at: home, plan: [], wait: 0, car: null, slot: this.slot(home) });
    };
    // Товар с ферм в магазины - грузовики и пикапы
    const trucks = Math.min(this.map.farms.length, Math.ceil(this.map.farms.length / 3));
    for (let i = 0; i < trucks && this.map.shops.length; i++) add('truck', pick(this.map.farms), chance(0.6) ? TRUCK : PICKUP);
    // Самосвалы - между шахтами и мастерскими
    const works = this.map.jobs.filter((p) => p.kind === 'work');
    if (works.length > 1) for (let i = 0; i < Math.min(4, Math.ceil(works.length / 2)); i++) add('dump', pick(works), DUMP);
    const services = this.map.jobs.length ? this.map.jobs : this.map.homes;
    for (let i = 0; i < Math.min(6, Math.floor(people / 150)); i++) add('taxi', pick(services), TAXI);
    for (let i = 0; i < Math.min(3, Math.floor(people / 300)); i++) add('police', pick(services), POLICE);
    for (const clinic of this.map.clinics.slice(0, 2)) add('ambulance', clinic, AMBULANCE);
    this.routeBuses(Math.min(3, Math.floor(people / 600)));
    // Посреди дня: кто должен быть на работе - уже там, план только на оставшиеся часы
    for (const a of this.agents) {
      if (a.work && this.now > 9.5 && this.now < 16.5) a.at = a.work;
      this.plan(a, this.now);
    }
  }

  /**
   * Автобусы: у каждого кольцо из BUS_STOPS остановок у магазинов, школ, лазаретов и больших домов,
   * обход по часовой стрелке вокруг их середины. Павильон на тротуаре у каждой остановки.
   */
  private routeBuses(count: number) {
    const m = this.map;
    const candidates = [...m.shops, ...m.schools, ...m.clinics, ...m.homes.filter((p) => p.weight >= 20)];
    const used = new Set<Place>();
    const shelterAt = new Map<number, Place>();
    for (let b = 0; b < count && candidates.length >= BUS_STOPS; b++) {
      const stops: Place[] = [];
      for (let tries = 0; stops.length < BUS_STOPS && tries < 60; tries++) {
        const p = candidates[Math.floor(rand() * candidates.length)];
        // Остановки не теснее двух клеток друг от друга и одна на клетку дороги
        if (used.has(p) || stops.some((q) => Math.hypot(q.x - p.x, q.z - p.z) < 2) || shelterAt.has(p.road)) continue;
        stops.push(p);
        used.add(p);
      }
      if (stops.length < 3) continue;
      const mx = stops.reduce((a, p) => a + p.x, 0) / stops.length, mz = stops.reduce((a, p) => a + p.z, 0) / stops.length;
      stops.sort((p, q) => Math.atan2(p.z - mz, p.x - mx) - Math.atan2(q.z - mz, q.x - mx));
      for (const p of stops) shelterAt.set(p.road, p);
      this.agents.push({ home: stops[0], work: null, school: null, kind: 'bus', model: BUS, at: stops[0], plan: [], wait: 0, car: null, slot: 0, stops });
    }
    // Павильон - на тротуаре за местом стоянки, лицом к улице
    let n = 0;
    for (const p of shelterAt.values()) {
      if (n >= this.shelters.instanceMatrix.count) break;
      const [dx, dz] = DIRS[p.dir];
      this.tmp.position.set(p.x - dx * 0.02, 0, p.z - dz * 0.02);
      this.tmp.rotation.set(0, Math.atan2(dx, dz), 0);
      this.tmp.updateMatrix();
      this.shelters.setMatrixAt(n++, this.tmp.matrix);
    }
    this.shelters.count = n;
    this.shelters.instanceMatrix.needsUpdate = true;
  }

  /** Места у бордюра по очереди среди машин одного дома: посередине, сзади, впереди. */
  private slot(home: Place): number {
    const taken = this.agents.filter((a) => a.home === home).length;
    return [0, -1, 1][taken % 3] * SLOT;
  }

  /** Где у места паркуется машина агента: точка у бордюра, сдвинутая вдоль фасада на его место. */
  private curb(a: Agent, p: Place): { x: number; z: number } {
    const [dx, dz] = DIRS[p.dir];
    return { x: p.x + dx * PARK_IN - dz * a.slot, z: p.z + dz * PARK_IN + dx * a.slot };
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
      case 'dump': {
        // Рейсы между промзонами с утра до вечера
        for (let h = between(6.5, 8); h < 18; h += between(1.5, 3)) {
          go(h, pick(this.map.jobs.filter((p) => p.kind === 'work')));
          go(h + 0.6, a.home);
        }
        break;
      }
      case 'ambulance': {
        // Вызовы в любое время суток, чаще днём
        for (let h = between(6, 9); h < 29; h += between(2, 5)) {
          go(h, pick(this.map.homes));
          go(h + 0.4, a.home);
        }
        break;
      }
      case 'bus': {
        // Круг за кругом с 6 до 23: на каждой остановке стоит BUS_DWELL, потом в депо (первая остановка)
        const stops = a.stops!;
        let i = stops.indexOf(a.at) + 1;
        for (let h = Math.max(6, from); h < 23; h += 0.05) go(h, stops[i++ % stops.length]);
        go(23, a.home);
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
      // Место у бордюра занято проезжающей машиной: машина дома появится, когда та проедет
      const spot = this.curb(a, a.at);
      if (this.cars.some((c) => { const p = this.pos.get(c); return p && Math.hypot(p[0] - spot.x, p[1] - spot.z) < 0.25; })) continue;
      const trip = a.plan.shift()!;
      if (trip.to === a.at) continue;
      // Автобус после 23 часов круг не продолжает - сразу в депо
      if (a.kind === 'bus' && this.now >= 23 && trip.to !== a.home) continue;
      const path = this.cars.length < this.maxCars ? this.map.path(a.at.road, trip.to.road) : null;
      if (!path) {
        // Нет дороги или улицы забиты - считаем, что доехал другим путём
        a.at = trip.to;
        continue;
      }
      const lane = driveLane(this.map.size, path, this.curb(a, a.at), this.curb(a, trip.to));
      const car: Car = { id: this.nextId++, agent: a, to: trip.to, path, lane, s: 0, v: 0, seg: 0, yaw: 0, blocked: 0, blocker: null, brake: false };
      car.yaw = Math.atan2(lane.pts[2] - lane.pts[0], lane.pts[3] - lane.pts[1]);
      a.car = car;
      this.cars.push(car);
    }
  }

  /** time - игровое время шага (с поправкой на скорость игры), dt - настоящее: на него идут предохранители. */
  private drive(time: number, dt: number) {
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
      let room = gate.dist;
      if (room <= 1e-4) {
        car.blocked += dt;
        // Предохранитель: перед красным стоим дольше, чем горит красный, перед человеком - пока он
        // не перейдёт (STUCK_LIMIT - на поломку); затор по кругу разъезжается через JAM_LIMIT
        const limit = gate.kind === 'light' ? RED_LIMIT : gate.kind === 'people' ? STUCK_LIMIT : JAM_LIMIT;
        if (car.blocked < limit) {
          car.v = 0;
          // Ждёт на улице - держит тормоз; у бордюра перед выездом - нет
          car.brake = car.s > 0.02;
          continue;
        }
        room = Infinity;
      } else car.blocked = 0;
      // Разгон до допустимой скорости: полная, к повороту - сниженная, к точке остановки - та,
      // с которой успеваем спокойно встать (корень из 2 * торможение * путь)
      const allowed = Math.min(this.bendLimit(car), Math.sqrt(2 * BRAKE * room));
      const before = car.v;
      car.v = Math.min(car.v + ACCEL * time, allowed);
      car.brake = car.v < before - 1e-4;
      car.s += Math.min(car.v * time, room);
      const { pts, len } = car.lane;
      while (car.seg < len.length - 2 && len[car.seg + 1] <= car.s) car.seg++;
      if (car.s >= len[len.length - 1] - 1e-6) done.push(car);
      // Корпус доворачивает к направлению отрезка дуги: дуга мелкая, поворот выходит плавным
      const i = car.seg * 2;
      const target = Math.atan2(pts[i + 2] - pts[i], pts[i + 3] - pts[i + 1]);
      let diff = target - car.yaw;
      diff = Math.atan2(Math.sin(diff), Math.cos(diff));
      car.yaw += diff * Math.min(1, time * 12);
    }
    for (const car of done) {
      const a = car.agent;
      a.car = null;
      a.at = car.to;
      // Стоянка: в магазине побыть, у школы - только высадить детей
      a.wait = this.now + (a.kind === 'bus' ? BUS_DWELL : this.map.shops.includes(car.to) ? between(0.5, 1) : 0.15);
      this.cars.splice(this.cars.indexOf(car), 1);
    }
  }

  private draw(dark: number) {
    const counts = new Array(this.meshes.length).fill(0);
    let lit = 0, tails = 0;
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
      // Задние огни на заднем бампере: днём - только стоп-сигналы
      if (showLights || car.brake) {
        const back = LENGTH[m] / 2 - 0.008;
        this.tmp.position.set(x - Math.sin(car.yaw) * back, 0, z - Math.cos(car.yaw) * back);
        this.tmp.rotation.set(0, car.yaw, 0);
        this.tmp.updateMatrix();
        this.tails.setMatrixAt(tails, this.tmp.matrix);
        this.tails.setColorAt(tails++, this.tailColor.setHex(car.brake ? 0xff2a1a : 0x8a1810));
      }
    }
    this.meshes.forEach((mesh, k) => {
      mesh.count = counts[k];
      mesh.instanceMatrix.needsUpdate = true;
    });
    this.lights.count = lit;
    this.lights.instanceMatrix.needsUpdate = true;
    this.tails.count = tails;
    this.tails.instanceMatrix.needsUpdate = true;
    if (this.tails.instanceColor) this.tails.instanceColor.needsUpdate = true;
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
