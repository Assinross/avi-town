// Жизнь двора (plan.md 010, этап 4; spec US4): днём во дворах многоэтажек рядом с камерой дети
// бегают по площадке, взрослые стоят у скамеек и разговаривают, кто-то гуляет по дорожке вдоль дома.
// Вечером людей меньше, ночью никого; в тревогу (налёт, банда рядом) все уходят.
// Только вид, фигуры из того же набора, что пешеходы (civilians.ts). Анимации "сидя" у моделей нет -
// на скамейках не сидят, стоят у них. Точки двора - те же, что в yards/apartment.ts.

import * as THREE from 'three';
import { SPEED_FACTOR, type World } from '@avi/sim';
import { apartmentYards, type ApartmentYard } from './cityMesh';
import { createCivilian, CIVILIAN_NAMES, type CivilianName } from './civilians';
import type { SkinnedHandle } from './skinnedModel';

type Role = 'kid' | 'talk' | 'walk';

interface Figure {
  body: SkinnedHandle;
  yard: ApartmentYard;
  role: Role;
  /** Положение в осях двора (u до зеркала, f). */
  u: number;
  f: number;
  /** Куда идёт; стоит, пока rest > 0. */
  tu: number;
  tf: number;
  rest: number;
  yaw: number;
  /** Собеседник: к нему стоят лицом. */
  mate: Figure | null;
  /** Через сколько секунд махнуть рукой (у разговаривающих). */
  wave: number;
}

/** Верх газона двора (yards/apartment.ts GROUND). */
const GROUND = 0.012;
const CHILD_SCALE = 0.72;
/** Скорость в клетках за секунду: ребёнок бегает, взрослый гуляет. */
const RUN = 0.32;
const WALK = 0.12;
/** Площадка в осях двора: качели, горка, песочница. */
const PLAY = { u0: -0.86, u1: -0.4, f0: -0.84, f1: -0.44 };
/** Взрослые разговаривают на дорожке у скамеек, лицом друг к другу. */
const TALK: [number, number][] = [[-0.44, -0.24], [-0.56, -0.24]];
/** Дорожка вдоль дома. */
const PATH = { u0: -0.9, u1: -0.1, f: -0.02 };
/** Насколько далеко от точки взгляда камеры дворы оживают. */
const RANGE = 9;
/** Как часто пересматривать, какие дворы оживлять (секунды). */
const RETHINK = 1;

const rand = Math.random;
const between = (a: number, b: number) => a + rand() * (b - a);

export class YardLife {
  readonly group = new THREE.Group();
  private yards: ApartmentYard[] = [];
  private figures: Figure[] = [];
  private world: World | null = null;
  private revision = -1;
  private timer = 0;

  constructor(private maxFigures: number) {}

  /** Новый мир: все уходят, дворы ищутся заново. */
  reset() {
    this.clear(() => true);
    this.world = null;
    this.revision = -1;
  }

  /**
   * hour - часы суток 0..24; focus - точка земли, куда смотрит камера; danger - где банда и бой:
   * дворы рядом с ними пустеют.
   */
  update(w: World, hour: number, dt: number, focus: { x: number; z: number }, danger: { x: number; z: number }[]) {
    this.group.visible = !w.mission;
    if (this.world !== w || this.revision !== w.revision) {
      this.world = w;
      this.revision = w.revision;
      this.yards = apartmentYards(w);
      const roots = new Set(this.yards.map((y) => y.root));
      this.clear((f) => !roots.has(f.yard.root));
      this.timer = 0;
    }
    if (!this.group.visible) return;
    const alarm = !!w.raid && w.raid.detected;
    const factor = w.over ? 0 : SPEED_FACTOR[w.speed];
    if ((this.timer -= dt) <= 0 || alarm) {
      this.timer = RETHINK;
      this.rethink(hour, focus, danger, alarm);
    }
    if (factor <= 0) return;
    const boost = Math.pow(factor, 0.7);
    for (const f of this.figures) this.step(f, dt * boost);
  }

  /** Сколько человек во дворе в этот час: [дети, разговаривают, гуляют]. */
  private crowd(hour: number, root: number): [number, number, number] {
    // У каждого двора свой состав, чтобы дворы не были одинаковыми
    const k = root % 3;
    if (hour >= 10 && hour < 19) return [1 + (k > 0 ? 1 : 0), k === 1 ? 0 : 2, k === 2 ? 0 : 1];
    if (hour >= 8 && hour < 21) return [0, k === 0 ? 2 : 0, 1];
    return [0, 0, 0];
  }

  /** Оживить дворы ближе к камере в пределах бюджета, остальные опустошить. */
  private rethink(hour: number, focus: { x: number; z: number }, danger: { x: number; z: number }[], alarm: boolean) {
    const center = (y: ApartmentYard) => y.at(-0.5 * y.mirror, -0.5);
    const quiet = (y: ApartmentYard) => {
      const [x, z] = center(y);
      return !alarm && !danger.some((d) => Math.hypot(d.x - x, d.z - z) < 4);
    };
    const near = this.yards
      .map((y) => ({ y, d: Math.hypot(center(y)[0] - focus.x, center(y)[1] - focus.z) }))
      .filter((e) => e.d < RANGE && quiet(e.y))
      .sort((a, b) => a.d - b.d);
    const chosen = new Map<number, [number, number, number]>();
    let budget = this.maxFigures;
    for (const { y } of near) {
      const c = this.crowd(hour, y.root);
      const n = c[0] + c[1] + c[2];
      if (!n || n > budget) continue;
      chosen.set(y.root, c);
      budget -= n;
    }
    // Ушли те, чей двор вне выбора или чей состав в этот час другой
    this.clear((f) => {
      const c = chosen.get(f.yard.root);
      if (!c) return true;
      const have = this.figures.filter((g) => g.yard === f.yard && g.role === f.role).length;
      return have > c[['kid', 'talk', 'walk'].indexOf(f.role)];
    });
    for (const y of this.yards) {
      const c = chosen.get(y.root);
      if (!c) continue;
      const roles: Role[] = ['kid', 'talk', 'walk'];
      roles.forEach((role, i) => {
        const have = this.figures.filter((f) => f.yard === y && f.role === role);
        for (let k = have.length; k < c[i]; k++) this.spawn(y, role, have);
      });
    }
  }

  private spawn(yard: ApartmentYard, role: Role, same: Figure[]) {
    const names: readonly CivilianName[] = role === 'kid' ? ['casual', 'hoodie'] : CIVILIAN_NAMES;
    const body = createCivilian(names[Math.floor(rand() * names.length)]);
    if (!body) return;
    if (role === 'kid') body.object.scale.setScalar(CHILD_SCALE);
    this.group.add(body.object);
    let u = between(PLAY.u0, PLAY.u1), f = between(PLAY.f0, PLAY.f1);
    if (role === 'talk') [u, f] = TALK[same.length % TALK.length];
    if (role === 'walk') [u, f] = [between(PATH.u0, PATH.u1), PATH.f];
    const fig: Figure = { body, yard, role, u, f, tu: u, tf: f, rest: between(0.5, 2), yaw: 0, mate: null, wave: between(3, 9) };
    if (role === 'talk') {
      const mate = same.find((s) => !s.mate) ?? null;
      if (mate) {
        fig.mate = mate;
        mate.mate = fig;
      }
    }
    body.loop('Idle');
    this.figures.push(fig);
    same.push(fig);
    this.put(fig);
  }

  private step(fig: Figure, dt: number) {
    fig.body.update(fig.role === 'kid' ? dt / CHILD_SCALE : dt);
    if (fig.role === 'talk') {
      // Стоят лицом к собеседнику, иногда машут рукой
      if (fig.mate) fig.yaw = this.heading(fig, fig.mate.u, fig.mate.f);
      if ((fig.wave -= dt) <= 0) {
        fig.body.once(rand() < 0.5 ? 'Wave' : 'Interact');
        fig.wave = between(5, 12);
      }
      this.put(fig);
      return;
    }
    if (fig.rest > 0) {
      if ((fig.rest -= dt) > 0) return;
      // Постояли - дальше: ребёнок к новой точке площадки, гуляющий - к другому концу дорожки
      if (fig.role === 'kid') [fig.tu, fig.tf] = [between(PLAY.u0, PLAY.u1), between(PLAY.f0, PLAY.f1)];
      else fig.tu = fig.u < (PATH.u0 + PATH.u1) / 2 ? between(PATH.u1 - 0.15, PATH.u1) : between(PATH.u0, PATH.u0 + 0.15);
      fig.body.loop(fig.role === 'kid' ? 'Run' : 'Walk');
    }
    const du = fig.tu - fig.u, df = fig.tf - fig.f;
    const d = Math.hypot(du, df);
    const step = (fig.role === 'kid' ? RUN : WALK) * dt;
    fig.yaw = this.heading(fig, fig.tu, fig.tf);
    if (d <= step) {
      fig.u = fig.tu;
      fig.f = fig.tf;
      fig.rest = fig.role === 'kid' ? between(0.6, 2.5) : between(2, 6);
      fig.body.loop('Idle');
    } else {
      fig.u += (du / d) * step;
      fig.f += (df / d) * step;
    }
    this.put(fig);
  }

  /** Поворот фигуры в мире, чтобы смотреть на точку двора (u, f). */
  private heading(fig: Figure, u: number, f: number): number {
    const [x0, z0] = fig.yard.at(fig.u * fig.yard.mirror, fig.f);
    const [x1, z1] = fig.yard.at(u * fig.yard.mirror, f);
    if (Math.hypot(x1 - x0, z1 - z0) < 1e-4) return fig.yaw;
    return Math.atan2(x1 - x0, z1 - z0);
  }

  private put(fig: Figure) {
    const [x, z] = fig.yard.at(fig.u * fig.yard.mirror, fig.f);
    fig.body.object.position.set(x, GROUND + 0.003, z);
    fig.body.object.rotation.y = fig.yaw;
  }

  /** Убрать фигуры, для которых gone(f) истинно. */
  private clear(gone: (f: Figure) => boolean) {
    const keep: Figure[] = [];
    for (const f of this.figures) {
      if (!gone(f)) {
        keep.push(f);
        continue;
      }
      if (f.mate) f.mate.mate = null;
      f.body.dispose();
      f.body.object.removeFromParent();
    }
    this.figures = keep;
  }
}
