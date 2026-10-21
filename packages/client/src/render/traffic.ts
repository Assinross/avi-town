// Машины на улицах живут по распорядку дня: утром родители везут детей в школу и едут на работу,
// в обед и вечером заезжают в магазины, после работы возвращаются домой; грузовики возят товар
// с промзон и ферм в торговлю, ночью по городу ездят такси и полиция.
// Только вид: на симуляцию не влияет, расписание строится заново каждые игровые сутки.

import * as THREE from 'three';
import { BUILDING_BY_ID } from '@avi/data';
import { builtLevel, CAPACITY, DAY_START_HOUR, decodeLot, DIRS, SPEED_FACTOR, TICKS_PER_DAY, type World } from '@avi/sim';
import { GeoBuilder } from './builder';
import { MODELS, type ModelName } from './models';

/** Место, куда ездят: клетка дороги у входа и точка у бордюра, где машина паркуется. */
interface Place { road: number; x: number; z: number; weight: number }

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
  agent: Agent;
  to: Place;
  /** Точки маршрута парами x, z. */
  pts: number[];
  seg: number;
  t: number;
  yaw: number;
}

const KAY = 0.5;
const CAR_SCALE = KAY * 0.5;
/** Низ колёс машин KayKit ниже точки привязки модели (как у машин на участках). */
const WHEEL_DROP = 0.061;
/** Смещение полосы от оси дороги: движение правостороннее. */
const LANE = 0.13;
/** Скорость в клетках за секунду на x1; на x2 и x4 растёт не вровень со временем, иначе машины мелькают. */
const SPEED = 3.2;
const SPEED_POWER = 0.7;
/** Столько жителей на одну машину. */
const PEOPLE_PER_CAR = 7;

const CAR_MODELS: ModelName[] = ['car_hatchback', 'car_sedan', 'car_stationwagon', 'car_taxi', 'car_police'];
const TAXI = 3, POLICE = 4, TRUCK = CAR_MODELS.length;

/** Поворот модели KayKit, чтобы капот смотрел по ходу движения (+z). */
const CAR_YAW = 0;

/** Часы суток 0..24 -> часы от начала игровых суток 6..30. */
const sinceStart = (hour: number) => (hour < DAY_START_HOUR ? hour + 24 : hour);

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
  private meshes: THREE.InstancedMesh[] = [];
  private lights: THREE.InstancedMesh;
  private lightMat: THREE.MeshBasicMaterial;
  private roadTop = 0;
  private isRoad = new Uint8Array(0);
  private homes: Place[] = [];
  private jobs: Place[] = [];
  private shops: Place[] = [];
  private schools: Place[] = [];
  private depots: Place[] = [];
  private agents: Agent[] = [];
  private cars: Car[] = [];
  private signature = '';
  private revision = -1;
  private sinceRebuild = Infinity;
  private dayIndex = -1;
  private tmp = new THREE.Object3D();
  private prev = new Int32Array(0);
  private now = DAY_START_HOUR;

  constructor(private maxCars: number) {
    const material = new THREE.MeshLambertMaterial({ vertexColors: true });
    // Высота асфальта - по центру дорожной модели, чтобы колёса стояли на полотне
    const road = MODELS.road_straight.pos;
    let top = 0;
    for (let i = 0; i < road.length; i += 3) if (Math.abs(road[i]) < 0.3 && Math.abs(road[i + 2]) < 0.3) top = Math.max(top, road[i + 1]);
    this.roadTop = top * KAY;
    const geos = CAR_MODELS.map((name) => {
      const g = new GeoBuilder();
      g.model(MODELS[name], 0, this.roadTop + WHEEL_DROP * CAR_SCALE, 0, CAR_SCALE);
      return g.build();
    });
    geos.push(truckGeometry(this.roadTop));
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
    const pool = new THREE.CircleGeometry(0.1, 10).rotateX(-Math.PI / 2).scale(1, 1, 1.8).translate(0, this.roadTop + 0.01, 0.24);
    this.lights = new THREE.InstancedMesh(pool, this.lightMat, maxCars);
    this.lights.count = 0;
    this.lights.frustumCulled = false;
    this.lights.userData.noOutline = true;
    this.group.add(this.lights);
  }

  /** Новый мир (загрузка, новая игра): все машины и семьи заново. */
  reset() {
    this.signature = '';
    this.revision = -1;
    this.cars = [];
    this.agents = [];
  }

  /** hour - время суток 0..24, dark - насколько темно 0..1 (фары). */
  update(w: World, hour: number, dark: number, dt: number) {
    this.group.visible = !w.mission;
    this.sinceRebuild += dt;
    this.now = sinceStart(hour);
    // Город меняется часто (каждый день) - места пересчитываются не чаще раза в 2 секунды
    if (this.revision !== w.revision && this.sinceRebuild > 2) {
      this.revision = w.revision;
      this.sinceRebuild = 0;
      this.rebuild(w);
    }
    const day = Math.floor(w.tick / TICKS_PER_DAY);
    if (day !== this.dayIndex) {
      // Новые сутки: у каждого свой план на день
      if (this.dayIndex >= 0) for (const a of this.agents) this.plan(a, DAY_START_HOUR);
      this.dayIndex = day;
    }
    const factor = w.over ? 0 : SPEED_FACTOR[w.speed];
    if (factor > 0) {
      this.depart(w);
      this.drive(dt * SPEED * Math.pow(factor, SPEED_POWER), dt);
    }
    this.draw(dark);
  }

  /** Места города по клеткам; семьи пересоздаются, только если поменялся набор мест. */
  private rebuild(w: World) {
    const n = w.size * w.size;
    this.isRoad = new Uint8Array(n);
    w.tiles.forEach((t, i) => { if (t.object === 'road') this.isRoad[i] = 1; });
    const homes: Place[] = [], jobs: Place[] = [], shops: Place[] = [], schools: Place[] = [], depots: Place[] = [];
    w.tiles.forEach((t, i) => {
      if (t.object === 'zone' && t.zone) {
        const level = builtLevel(t);
        if (level <= 0) return;
        // Жильё и торговля - участками: вход у главной клетки; промзоны и фермы - каждая клетка
        if (t.lot === 0 && t.root >= 0 && t.root !== i) return;
        const lot = decodeLot(t.lot);
        const p = this.place(w, i, CAPACITY[t.zone][level], lot ? lot.dir : -1);
        if (!p) return;
        if (t.zone === 'R') homes.push(p);
        else {
          jobs.push(p);
          if (t.zone === 'C') shops.push(p);
          else depots.push(p);
        }
      } else if (t.object === 'building' && t.root === i && t.build === 0) {
        const def = BUILDING_BY_ID[t.def!];
        if (!def) return;
        const p = this.place(w, i, 6, -1);
        if (!p) return;
        jobs.push(p);
        if (def.service?.kind === 'education') schools.push({ ...p, weight: 1 });
      }
    });
    Object.assign(this, { homes, jobs, shops, schools, depots });
    const signature = [homes, jobs, schools].map((l) => l.map((p) => `${p.road}:${p.weight}`).join(',')).join('|');
    if (signature === this.signature) return;
    this.signature = signature;
    this.populate();
  }

  /** Вход места: соседняя дорога (у участка - в сторону его улицы), иначе ближайшая в 2 клетках. */
  private place(w: World, idx: number, weight: number, dir: number): Place | null {
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
            return { road: ny * s + nx, x: bx + 0.5, z: bz + 0.5, weight };
          }
        }
      }
    }
    return null;
  }

  /** Сколько машин и у кого: семьи по числу жителей, грузовики по промзонам и фермам, такси и полиция. */
  private populate() {
    this.agents = [];
    const people = this.homes.reduce((sum, p) => sum + p.weight, 0);
    const jobSlots = this.jobs.reduce((sum, p) => sum + p.weight, 0);
    const families = Math.min(Math.ceil(people / PEOPLE_PER_CAR), this.maxCars * 2);
    // Работы на всех может не хватать: безработные днём ездят по магазинам
    const employed = people ? Math.min(1, jobSlots / people) : 0;
    for (let i = 0; i < families; i++) {
      const home = pick(this.homes)!;
      const work = chance(employed) ? pick(this.jobs) : null;
      const school = chance(0.4) ? this.nearest(this.schools, home) : null;
      this.agents.push({ home, work, school, kind: 'family', model: Math.floor(rand() * TAXI), at: home, plan: [], wait: 0, car: null });
    }
    const trucks = Math.min(this.depots.length, Math.ceil(this.depots.length / 3));
    for (let i = 0; i < trucks && this.shops.length; i++) {
      const home = pick(this.depots)!;
      this.agents.push({ home, work: null, school: null, kind: 'truck', model: TRUCK, at: home, plan: [], wait: 0, car: null });
    }
    const service = (kind: 'taxi' | 'police', count: number, model: number) => {
      for (let i = 0; i < count; i++) {
        const home = pick(this.jobs.length ? this.jobs : this.homes);
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
    const shop = () => pick(this.shops);
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
        for (let h = between(18, 19.5); h < 29; h += between(0.8, 1.8)) go(h, chance(0.5) ? pick(this.homes) : pick(this.jobs));
        break;
      }
      case 'police': {
        for (let h = between(6, 8); h < 30; h += between(1.5, 3)) go(h, chance(0.5) ? pick(this.homes) : pick(this.jobs));
        break;
      }
    }
    trips.sort((x, y) => x.hour - y.hour);
    a.plan = trips.filter((t) => t.hour >= from);
    a.wait = 0;
  }

  /** Отправить в путь всех, чьё время пришло и кто не в дороге. */
  private depart(w: World) {
    for (const a of this.agents) {
      if (a.car || !a.plan.length || a.plan[0].hour > this.now || a.wait > this.now) continue;
      const trip = a.plan.shift()!;
      if (trip.to === a.at) continue;
      const path = this.cars.length < this.maxCars ? this.path(w.size, a.at.road, trip.to.road) : null;
      if (!path) {
        // Нет дороги или улицы забиты - считаем, что доехал другим путём
        a.at = trip.to;
        continue;
      }
      const car: Car = { agent: a, to: trip.to, pts: route(w.size, path, a.at, trip.to), seg: 0, t: 0, yaw: 0 };
      car.yaw = Math.atan2(car.pts[2] - car.pts[0], car.pts[3] - car.pts[1]);
      a.car = car;
      this.cars.push(car);
    }
  }

  /** Кратчайший путь по клеткам дорог (поиск в ширину); null - не связаны. */
  private path(size: number, from: number, to: number): number[] | null {
    if (this.prev.length !== this.isRoad.length) this.prev = new Int32Array(this.isRoad.length);
    if (!this.isRoad[from] || !this.isRoad[to]) return null;
    const prev = this.prev.fill(-1);
    prev[from] = from;
    const queue = [from];
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

  private drive(dist: number, dt: number) {
    const done: Car[] = [];
    for (const car of this.cars) {
      let left = dist;
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
      a.wait = this.now + (this.shops.includes(car.to) ? between(0.5, 1) : 0.15);
      this.cars.splice(this.cars.indexOf(car), 1);
    }
  }

  private draw(dark: number) {
    const counts = new Array(this.meshes.length).fill(0);
    let lit = 0;
    const showLights = dark > 0.2;
    this.lightMat.opacity = Math.min(1, (dark - 0.2) * 1.6) * 0.75;
    for (const car of this.cars) {
      const i = car.seg * 2, p = car.pts;
      const last = p.length / 2 - 1;
      let x = p[p.length - 2], z = p[p.length - 1];
      if (car.seg < last) {
        const len = Math.hypot(p[i + 2] - p[i], p[i + 3] - p[i + 1]) || 1;
        const k = car.t / len;
        x = p[i] + (p[i + 2] - p[i]) * k;
        z = p[i + 1] + (p[i + 3] - p[i + 1]) * k;
      }
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

/** Точки маршрута: от бордюра на свою полосу, по полосе через центры клеток (повороты - по углу полосы), к бордюру. */
function route(size: number, path: number[], from: Place, to: Place): number[] {
  const pts = [from.x, from.z];
  const cell = (i: number) => [path[i] % size, Math.floor(path[i] / size)];
  const dir = (a: number, b: number) => {
    const [ax, ay] = cell(a), [bx, by] = cell(b);
    return [bx - ax, by - ay];
  };
  // Правая сторона по ходу (x, z): для движения по +x это +z
  const right = ([dx, dz]: number[]) => [-dz, dx];
  if (path.length > 1) {
    for (let i = 0; i < path.length; i++) {
      const din = dir(Math.max(0, i - 1), Math.max(1, i));
      const dout = i < path.length - 1 ? dir(i, i + 1) : din;
      const [cx, cz] = cell(i);
      const r1 = right(i === 0 ? dout : din), r2 = right(dout);
      const turn = i > 0 && (din[0] !== dout[0] || din[1] !== dout[1]);
      pts.push(cx + 0.5 + (r1[0] + (turn ? r2[0] : 0)) * LANE, cz + 0.5 + (r1[1] + (turn ? r2[1] : 0)) * LANE);
    }
  }
  pts.push(to.x, to.z);
  return pts;
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
