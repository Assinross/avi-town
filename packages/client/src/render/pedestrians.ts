// Пешеходы на улицах: идут по делам (работа, магазин, школа с ребёнком, лазарет) и на прогулку
// вечером. Тротуара в плитке KayKit нет - люди идут по краю полотна на смещении WALK_LANE,
// улицу переходят только по зебре, в здание входят через дверь с анимацией Interact.
// Только вид: население, экономика и бой не меняются, расписание строится заново каждые сутки.

import * as THREE from 'three';
import { SPEED_FACTOR, type World } from '@avi/sim';
import { CYCLE_START_HOUR as DAY_START_HOUR } from './dayCycle';
import { CityMap, roadTop, WALK_LANE, type Place } from './cityMap';
import { walkLift } from './streets';
import { createCivilian, type CivilianName } from './civilians';
import type { SkinnedHandle } from './skinnedModel';
import type { Traffic } from './traffic';

/** Скорость шага в клетках за секунду на x1 - как в жизни: ~1.3 м/с при клетке ~10 м. */
const SPEED = 0.13;
const SPEED_POWER = 0.7;
/** Анимация шага и бега - в своём темпе: при живой скорости ноги не скользят. */
const ANIM_SPEED = 1;
/** Один пешеход на столько жителей. */
const PEOPLE_PER_WALKER = 4;
/** Дальше стольких клеток по тротуарам человек не идёт - такие поездки на машинах. */
const MAX_TRIP = 6;
/** Сколько мест проверить маршрутом, прежде чем решить, что пешком идти некуда. */
const REACH_TRIES = 8;
/** Дольше этого человек не ждёт на зебре: машины притормозят. */
const CROSS_WAIT = 18;
/** Сколько секунд идёт анимация входа в дверь, прежде чем человек исчезнет. */
const ENTER_TIME = 0.85;
/** Ребёнок - уменьшенная копия матери. */
const CHILD_SCALE = 0.72;
/** Во сколько раз паникующий житель быстрее обычного шага: бег ~3.5 м/с. */
const RUN = 2.6;
/** Ближе этого от места попадания человек падает. */
const BLAST_RADIUS = 1.3;
/** Ближе этого укрытие не выбираем: иначе человек прячется в двух шагах и бега не видно. */
const SHELTER_MIN = 2;
/** Банда или перестрелка ближе этого (в клетках) - прохожий бросает дела и убегает. */
const THREAT_RADIUS = 3;
/** Убегают в дом не ближе этого к опасности. */
const THREAT_SAFE = 4.5;
/** Попадание снаряда НЛО в клетках города. */
export interface Blast {
  x: number;
  z: number;
}

/** Поездка по расписанию; to = null - прогулка по своему кварталу. */
interface Trip {
  hour: number;
  to: Place | null;
  /** Идёт ли с матерью ребёнок (только в школу и из школы). */
  child: boolean;
}

/** Маршрут по тротуарам: точки парами x, z и место ожидания перед переходом. */
interface Route {
  pts: number[];
  gate: number;
  gateCell: number;
}

/** Горожанин на улице: где он сейчас и куда пойдёт сегодня. */
interface Walker {
  home: Place;
  work: Place | null;
  school: Place | null;
  /** Водит ребёнка в школу. */
  mother: boolean;
  model: CivilianName;
  at: Place;
  plan: Trip[];
  /** Не выходить раньше этого часа (6..30). */
  wait: number;
  body: SkinnedHandle | null;
  child: SkinnedHandle | null;
  /** Точки маршрута парами x, z. */
  pts: number[];
  seg: number;
  t: number;
  yaw: number;
  to: Place | null;
  gate: number;
  gateCell: number;
  crossed: boolean;
  waited: number;
  /** Сколько секунд осталось до исчезновения в двери; 0 - не входим. */
  entering: number;
  walking: boolean;
  /** Налёт: бежит в укрытие, лежит после попадания или уже спрятался. */
  panic: 'flee' | 'down' | 'hide' | null;
}

/** Часы суток 0..24 -> часы от начала игровых суток 6..30. */
const sinceStart = (hour: number) => (hour < DAY_START_HOUR ? hour + 24 : hour);

const rand = Math.random;
const between = (a: number, b: number) => a + rand() * (b - a);
const chance = (p: number) => rand() < p;

function pick(list: Place[]): Place | null {
  if (!list.length) return null;
  let total = 0;
  for (const p of list) total += p.weight;
  let r = rand() * total;
  for (const p of list) if ((r -= p.weight) <= 0) return p;
  return list[list.length - 1];
}

/** Роль по месту работы: фермер - на ферму, рабочий - в промзону, офисный - в торговлю. */
function modelFor(work: Place | null, mother: boolean): CivilianName {
  if (mother) return chance(0.6) ? 'woman' : 'suit';
  switch (work?.kind) {
    case 'farm': return 'farmer';
    case 'work': return 'worker';
    case 'shop': return chance(0.5) ? 'businessman' : 'suit';
    case 'service': return chance(0.5) ? 'worker' : 'businessman';
    default: return chance(0.5) ? 'casual' : 'hoodie';
  }
}

export class Pedestrians {
  readonly group = new THREE.Group();
  private walkers: Walker[] = [];
  private dayIndex = -1;
  private now = DAY_START_HOUR;
  private traffic: Traffic | null = null;
  /** Идёт налёт: горожане прячутся. */
  private raiding = false;
  private blasts: Blast[] = [];
  private threats: Blast[] = [];

  constructor(private map: CityMap, private maxPeople: number) {}

  /** Машины нужны пешеходу, чтобы решить, шагать ли на зебру. */
  setTraffic(traffic: Traffic) {
    this.traffic = traffic;
  }

  /** Новый мир (загрузка, новая игра): все горожане заново. */
  reset() {
    this.clear();
    this.dayIndex = -1;
  }

  /** Набор мест изменился (новый город): горожане собираются заново. */
  repopulate() {
    this.populate();
  }

  /**
   * Кто на зебре: 'walk' - человек шагает по ней, машины перед ней стоят; 'wait' - ждёт у края
   * и ему можно идти (светофора нет или машинам красный) - машины, которые успевают, его пропускают.
   */
  onCrossing(cell: number): 'walk' | 'wait' | null {
    let found: 'wait' | null = null;
    for (const walker of this.walkers) {
      if (!walker.walking || walker.gateCell !== cell) continue;
      if (!walker.crossed) {
        const axis = this.map.crossAxis.get(cell);
        if (walker.seg === walker.gate && (axis === undefined || this.map.light(axis) === 'red')) found = 'wait';
        continue;
      }
      // Середина перехода и первые шаги после него
      if (walker.seg === walker.gate) return 'walk';
      if (walker.seg === walker.gate + 1 && walker.t < 0.25) return 'walk';
    }
    return found;
  }

  update(w: World, hour: number, day: number, dt: number) {
    this.group.visible = !w.mission;
    this.now = sinceStart(hour);
    if (day !== this.dayIndex) {
      // Новые сутки: у каждого свой распорядок
      if (this.dayIndex >= 0) {
        this.clear();
        this.populate();
      }
      this.dayIndex = day;
    }
    if (!this.group.visible) return;
    // Налёт: горожане бросают дела и прячутся, а после него возвращаются к распорядку
    const raiding = !!w.raid && w.raid.detected;
    if (raiding !== this.raiding) {
      this.raiding = raiding;
      if (raiding) this.panic();
      else {
        this.clear();
        this.populate();
      }
    }
    const factor = w.over ? 0 : SPEED_FACTOR[w.speed];
    if (factor <= 0) return;
    const boost = Math.pow(factor, SPEED_POWER);
    if (this.raiding) this.fall();
    else {
      this.depart();
      if (this.threats.length) this.scatter();
    }
    for (const walker of this.walkers) {
      const run = walker.panic === 'flee' ? RUN : 1;
      this.step(walker, dt * SPEED * boost * run, dt * boost);
    }
  }

  /** Снаряды НЛО за кадр: рядом с попаданием жители падают. */
  setBlasts(list: Blast[]) {
    this.blasts = list;
  }

  /** Где сейчас банда и перестрелка: прохожие рядом разбегаются. */
  setThreats(list: Blast[]) {
    this.threats = list;
  }

  /** Банда на улице: кто оказался рядом - убегает в дом подальше от неё. */
  private scatter() {
    for (const walker of this.walkers) {
      if (!walker.body || walker.panic || walker.entering > 0) continue;
      const [x, z] = this.pos(walker);
      const near = this.threats.find((b) => Math.hypot(b.x - x, b.z - z) < THREAT_RADIUS);
      if (!near) continue;
      let best: Place | null = null, bestD = Infinity;
      for (const p of [...this.map.homes, ...this.map.jobs, ...this.map.schools, ...this.map.clinics, ...this.map.farms]) {
        if (this.threats.some((b) => Math.hypot(b.x - p.x, b.z - p.z) < THREAT_SAFE)) continue;
        const d = Math.hypot(p.x - x, p.z - z);
        if (d < bestD) {
          bestD = d;
          best = p;
        }
      }
      if (best) this.flee(walker, x, z, best);
    }
  }

  /** Налёт: кто на улице - бежит к ближайшему входу, кто в доме - и так спрятан. */
  private panic() {
    for (const walker of this.walkers) {
      if (!walker.body || walker.entering > 0) continue;
      const [x, z] = this.pos(walker);
      const shelter = this.shelter(x, z);
      if (shelter) this.flee(walker, x, z, shelter);
    }
  }

  /** Бросить дела и бежать к двери укрытия. */
  private flee(walker: Walker, x: number, z: number, shelter: Place) {
    const door = this.map.door(shelter);
    walker.panic = 'flee';
    walker.to = shelter;
    walker.pts = [x, z, door.x, door.z];
    walker.seg = 0;
    walker.t = 0;
    walker.gate = -1;
    walker.gateCell = -1;
    walker.crossed = true;
    walker.waited = 0;
    walker.entering = 0;
    walker.walking = true;
    walker.yaw = Math.atan2(door.x - x, door.z - z);
    walker.body?.loop('Run');
    walker.child?.loop('Run');
  }

  /**
   * Ближайший вход, где можно спрятаться: жильё, работа, школа, лазарет или ферма.
   * Совсем рядом с человеком укрытие не берём - иначе он прячется в двух шагах.
   */
  private shelter(x: number, z: number): Place | null {
    const map = this.map;
    let best: Place | null = null, bestD = Infinity;
    let far: Place | null = null, farD = Infinity;
    for (const p of [...map.homes, ...map.jobs, ...map.schools, ...map.clinics, ...map.farms]) {
      const d = Math.hypot(p.x - x, p.z - z);
      if (d < bestD) {
        bestD = d;
        best = p;
      }
      if (d >= SHELTER_MIN && d < farD) {
        farD = d;
        far = p;
      }
    }
    return far ?? best;
  }

  /** Кто оказался рядом с попаданием - падает и лежит до конца налёта. */
  private fall() {
    if (!this.blasts.length) return;
    for (const walker of this.walkers) {
      if (!walker.body || walker.panic === 'down' || walker.panic === 'hide' || walker.entering > 0) continue;
      const [x, z] = this.pos(walker);
      for (const b of this.blasts) {
        if (Math.hypot(b.x - x, b.z - z) > BLAST_RADIUS) continue;
        walker.panic = 'down';
        walker.walking = false;
        walker.body.once('Death', true);
        walker.child?.once('Death', true);
        break;
      }
    }
  }

  /** Кто и сколько: один пешеход на несколько жителей, не больше предела качества. */
  private populate() {
    this.clear();
    const map = this.map;
    const people = map.homes.reduce((sum, p) => sum + p.weight, 0);
    const count = Math.min(this.maxPeople, Math.ceil(people / PEOPLE_PER_WALKER));
    const slots = map.jobs.reduce((sum, p) => sum + p.weight, 0);
    // Работы на всех может не хватать - безработные ходят по магазинам и гуляют
    const employed = people ? Math.min(1, slots / people) : 0;
    for (let i = 0; i < count; i++) {
      const home = pick(map.homes);
      if (!home) break;
      // Пешком ходят только туда, куда реально дойти: дальняя работа и школа - поездки на машинах
      const work = chance(employed) ? this.reachable(map.jobs, home) : null;
      const school = chance(0.45) ? this.reachable(map.schools, home) : null;
      const mother = !!school && chance(0.7);
      const walker: Walker = {
        home, work, school, mother, model: modelFor(work, mother), at: home, plan: [], wait: 0,
        body: null, child: null, pts: [], seg: 0, t: 0, yaw: 0, to: null,
        gate: -1, gateCell: -1, crossed: false, waited: 0, entering: 0, walking: false, panic: null,
      };
      // Посреди дня: кто на работе - уже там, план только на оставшиеся часы
      if (work && this.now > 9.5 && this.now < 16.5) walker.at = work;
      this.plan(walker, this.now);
      this.walkers.push(walker);
    }
  }

  /** Распорядок на сутки; поездки раньше from (уже прошедшие часы) не попадают. */
  private plan(walker: Walker, from: number) {
    const trips: Trip[] = [];
    const go = (hour: number, to: Place | null, child = false) => trips.push({ hour, to, child });
    const shop = (from: Place) => this.reachable(this.map.shops, from);
    // Мать ведёт ребёнка в школу утром и забирает после уроков
    if (walker.mother && walker.school) {
      go(between(6.9, 7.5), walker.school, true);
      go(between(7.6, 7.9), walker.home);
      go(between(14.6, 15.2), walker.school, true);
      go(between(15.3, 15.7), walker.home);
    }
    if (walker.work) {
      go(between(7.6, 8.4), walker.work);
      // В обед - в магазин рядом с работой, если до него можно дойти
      const lunch = chance(0.25) ? shop(walker.work) : null;
      if (lunch) {
        go(between(12, 13), lunch);
        go(13.2, walker.work);
      }
      go(between(16.8, 18.2), walker.home);
    } else if (!walker.mother) {
      go(between(9.5, 11), shop(walker.home));
      go(between(11, 12), walker.home);
    }
    // Вечерняя прогулка по своему кварталу: выход до 19, чтобы возвращение домой (с 19:12) было позже
    if (chance(0.7)) {
      go(between(18, 19), null);
      go(between(19.2, 20), walker.home);
    }
    trips.sort((a, b) => a.hour - b.hour);
    walker.plan = trips.filter((t) => t.hour >= from);
    walker.wait = 0;
  }

  /** Отправить в путь всех, чьё время пришло и кто не в дороге. */
  private depart() {
    for (const walker of this.walkers) {
      if (walker.walking || walker.entering > 0 || !walker.plan.length) continue;
      if (walker.plan[0].hour > this.now || walker.wait > this.now) continue;
      const trip = walker.plan.shift()!;
      const to = trip.to ?? this.strollSpot(walker);
      // Нет улицы для прогулки или цель - то же место, где он стоит
      if (!to || to === walker.at) continue;
      const route = this.walkRoute(walker.at, to);
      // По тротуарам не дойти (нет зебры или слишком далеко) - поездка не начинается
      if (!route) continue;
      this.start(walker, to, route, trip);
    }
  }

  private start(walker: Walker, to: Place, route: Route, trip: Trip) {
    walker.to = to;
    walker.pts = route.pts;
    walker.seg = 0;
    walker.t = 0;
    walker.gate = route.gate;
    walker.gateCell = route.gateCell;
    walker.crossed = false;
    walker.waited = 0;
    walker.yaw = Math.atan2(route.pts[2] - route.pts[0], route.pts[3] - route.pts[1]);
    if (!walker.body) walker.body = this.makeBody(walker.model);
    if (!walker.body) return;
    walker.walking = true;
    walker.body.loop('Walk');
    // Ребёнок идёт рядом только в школу и из школы
    if (trip.child) {
      if (!walker.child) walker.child = this.makeBody(walker.model);
      if (walker.child) {
        walker.child.object.scale.setScalar(CHILD_SCALE);
        walker.child.loop('Walk');
      }
    } else if (walker.child) {
      walker.child.dispose();
      walker.child.object.removeFromParent();
      walker.child = null;
    }
    this.put(walker);
  }

  private makeBody(name: CivilianName): SkinnedHandle | null {
    const body = createCivilian(name);
    if (!body) return null;
    this.group.add(body.object);
    return body;
  }

  private step(walker: Walker, dist: number, dt: number) {
    const anim = dt * (walker.walking ? ANIM_SPEED : 1);
    walker.body?.update(anim);
    // У ребёнка шаг короче - ногами он перебирает чаще
    walker.child?.update(walker.walking ? anim / CHILD_SCALE : anim);
    if (walker.entering > 0) {
      // Interact у двери доиграл - человек вошёл и исчез
      walker.entering -= dt;
      if (walker.entering <= 0) {
        this.dropBody(walker);
        if (walker.panic) walker.panic = 'hide';
      }
      return;
    }
    if (!walker.walking) return;
    this.advance(walker, dist, dt);
    if (!walker.walking) return;
    this.face(walker, dt);
    this.put(walker);
  }

  private advance(walker: Walker, dist: number, dt: number) {
    const p = walker.pts;
    let left = dist;
    while (left > 0 && walker.seg < p.length / 2 - 1) {
      // Перед зеброй человек ждёт, пока проедет машина
      if (walker.seg === walker.gate && !walker.crossed) {
        if (!this.crossNow(walker, dt)) return;
        walker.crossed = true;
      }
      const i = walker.seg * 2;
      const len = Math.hypot(p[i + 2] - p[i], p[i + 3] - p[i + 1]);
      const step = Math.min(left, len - walker.t);
      walker.t += step;
      left -= step;
      if (walker.t >= len - 1e-6) {
        walker.seg++;
        walker.t = 0;
      }
    }
    if (walker.seg >= p.length / 2 - 1) this.arrive(walker);
  }

  private crossNow(walker: Walker, dt: number): boolean {
    walker.waited += dt;
    const clear = this.traffic ? this.traffic.crossingClear(walker.gateCell) : true;
    // Светофор: человек идёт на красный для машин; без светофора - когда машин рядом нет
    const axis = this.map.crossAxis.get(walker.gateCell);
    const green = axis === undefined || this.map.light(axis) === 'red';
    if ((!clear || !green) && walker.waited < CROSS_WAIT) {
      walker.body?.loop('Idle');
      return false;
    }
    walker.body?.loop('Walk');
    return true;
  }

  private arrive(walker: Walker) {
    walker.walking = false;
    walker.at = walker.to!;
    // Прогулка: человек остаётся стоять на улице, пока не придёт время идти назад
    if (walker.at.kind === 'stroll' || !walker.body) {
      walker.body?.loop('Idle');
      return;
    }
    walker.entering = ENTER_TIME;
    walker.body.once('Interact');
    walker.child?.once('Interact');
  }

  private dropBody(walker: Walker) {
    for (const handle of [walker.body, walker.child]) {
      if (!handle) continue;
      handle.dispose();
      handle.object.removeFromParent();
    }
    walker.body = null;
    walker.child = null;
  }

  private pos(walker: Walker): [number, number] {
    const p = walker.pts;
    const last = p.length / 2 - 1;
    if (walker.seg >= last) return [p[p.length - 2], p[p.length - 1]];
    const i = walker.seg * 2;
    const len = Math.hypot(p[i + 2] - p[i], p[i + 3] - p[i + 1]) || 1;
    const k = walker.t / len;
    return [p[i] + (p[i + 2] - p[i]) * k, p[i + 1] + (p[i + 3] - p[i + 1]) * k];
  }

  private face(walker: Walker, dt: number) {
    const p = walker.pts;
    const i = Math.min(walker.seg, p.length / 2 - 2) * 2;
    const target = Math.atan2(p[i + 2] - p[i], p[i + 3] - p[i + 1]);
    let diff = target - walker.yaw;
    diff = Math.atan2(Math.sin(diff), Math.cos(diff));
    walker.yaw += diff * Math.min(1, dt * 12);
  }

  private put(walker: Walker) {
    const body = walker.body;
    if (!body) return;
    const [x, z] = this.pos(walker);
    const y = roadTop() + 0.004 + walkLift(this.map, x, z);
    body.object.position.set(x, y, z);
    body.object.rotation.y = walker.yaw;
    const kid = walker.child;
    if (kid) {
      // Ребёнок держится рядом и чуть позади матери
      const fx = Math.sin(walker.yaw), fz = Math.cos(walker.yaw);
      kid.object.position.set(x - fx * 0.07 + fz * 0.055, y, z - fz * 0.07 - fx * 0.055);
      kid.object.rotation.y = walker.yaw;
    }
  }

  /**
   * Место из списка, до которого от from дойти пешком: не дальше MAX_TRIP клеток по дорогам
   * и, если вход на другой стороне улицы, с зеброй по пути. Выбор с учётом веса места.
   */
  private reachable(list: Place[], from: Place): Place | null {
    const near = this.map.near(from.road, MAX_TRIP - 1);
    const close = list.filter((p) => p !== from && near.has(p.road));
    for (let i = 0; i < REACH_TRIES && close.length; i++) {
      const p = pick(close)!;
      if (this.walkRoute(from, p)) return p;
      close.splice(close.indexOf(p), 1);
    }
    return null;
  }

  /**
   * Маршрут от двери до двери: дверь - бордюр - улицы - бордюр - дверь.
   * Если вход на другой стороне улицы, человек переходит её по зебре.
   */
  private walkRoute(from: Place, to: Place): Route | null {
    const path = this.map.path(from.road, to.road);
    if (!path || path.length > MAX_TRIP) return null;
    const doorA = this.map.door(from), doorB = this.map.door(to);
    const head = from.kind === 'stroll' ? [from.x, from.z] : [doorA.x, doorA.z, from.x, from.z];
    const tail = to.kind === 'stroll' ? [to.x, to.z] : [to.x, to.z, doorB.x, doorB.z];
    const cross = this.needCross(path, from, to);
    if (!cross.need) {
      return { pts: [...head, ...this.map.route(path, WALK_LANE, 1), ...tail], gate: -1, gateCell: -1 };
    }
    // Зебры по пути нет - по тротуарам до этого входа не дойти
    if (cross.k < 0) return null;
    const before = this.map.route(path.slice(0, cross.k + 1), WALK_LANE, 1);
    const after = this.map.route(path.slice(cross.k), WALK_LANE, -1);
    // Ждём и переходим на последней точке перед зеброй
    const gate = head.length / 2 + before.length / 2 - 1;
    return { pts: [...head, ...before, ...after, ...tail], gate, gateCell: path[cross.k] };
  }

  /** Нужно ли переходить улицу: вход в цель на другой стороне от хода по последней клетке. */
  private needCross(path: number[], from: Place, to: Place): { need: boolean; k: number } {
    const size = this.map.size;
    const last = path[path.length - 1];
    const lx = (last % size) + 0.5, lz = Math.floor(last / size) + 0.5;
    let rx: number, rz: number;
    if (path.length > 1) {
      const prev = path[path.length - 2];
      rx = -((lz - (Math.floor(prev / size) + 0.5)));
      rz = lx - ((prev % size) + 0.5);
    } else {
      // Улица в одну клетку: сторона входа сравнивается со стороной выхода из дома
      rx = from.x - lx;
      rz = from.z - lz;
    }
    if ((to.x - lx) * rx + (to.z - lz) * rz >= 0) return { need: false, k: -1 };
    for (let i = path.length - 1; i >= 0; i--) {
      if (this.map.crossings.has(path[i])) return { need: true, k: i };
    }
    return { need: true, k: -1 };
  }

  /** Куда пойти гулять: улица в двух-пяти клетках от дома, точка на стороне подхода. */
  private strollSpot(walker: Walker): Place | null {
    const s = this.map.size;
    const hx = walker.home.road % s, hy = Math.floor(walker.home.road / s);
    const cells: number[] = [];
    for (let y = Math.max(0, hy - 5); y <= Math.min(s - 1, hy + 5); y++) {
      for (let x = Math.max(0, hx - 5); x <= Math.min(s - 1, hx + 5); x++) {
        const i = y * s + x;
        if (!this.map.isRoad[i]) continue;
        const d = Math.abs(x - hx) + Math.abs(y - hy);
        if (d >= 2 && d <= 5) cells.push(i);
      }
    }
    if (!cells.length) return null;
    const road = cells[Math.floor(rand() * cells.length)];
    const path = this.map.path(walker.home.road, road);
    if (!path || path.length > MAX_TRIP) return null;
    const last = path[path.length - 1];
    const lx = (last % s) + 0.5, lz = Math.floor(last / s) + 0.5;
    let ox = 0, oz = 0;
    if (path.length > 1) {
      const prev = path[path.length - 2];
      const dx = lx - ((prev % s) + 0.5), dz = lz - (Math.floor(prev / s) + 0.5);
      ox = -dz * WALK_LANE;
      oz = dx * WALK_LANE;
    }
    return { road, x: lx + ox, z: lz + oz, cell: road, kind: 'stroll', weight: 0, dir: 0 };
  }

  /** Где сейчас люди на улице и куда смотрят - для рисованных спрайтов (?sprites, sprites/spriteLayer.ts). */
  *figures(): Generator<{ id: object; x: number; z: number; yaw: number; walking: boolean; model: CivilianName; child: boolean }> {
    if (!this.group.visible) return;
    for (const walker of this.walkers) {
      for (const h of [walker.body, walker.child]) {
        if (!h || !h.object.visible) continue;
        const p = h.object.position;
        yield { id: h, x: p.x, z: p.z, yaw: walker.yaw, walking: walker.walking && walker.panic !== 'down', model: walker.model, child: h === walker.child };
      }
    }
  }

  private clear() {
    for (const walker of this.walkers) this.dropBody(walker);
    this.walkers = [];
  }
}
