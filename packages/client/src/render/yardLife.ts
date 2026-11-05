// Жизнь двора (plan.md 010, этап 4; spec US4): днём во дворах многоэтажек рядом с камерой дети
// бегают по площадке, взрослые стоят у скамеек и разговаривают, кто-то гуляет по дорожке вдоль дома.
// Вечером людей меньше, ночью никого; в тревогу (налёт, банда рядом) все уходят.
// Только вид, фигуры из того же набора, что пешеходы (civilians.ts). Анимации "сидя" у моделей нет -
// на скамейках не сидят, стоят у них. Дворы R2 и скверы C3 - по раскладке yards/lots.ts.

import * as THREE from 'three';
import { SPEED_FACTOR, type World } from '@avi/sim';
import { activityYards, type ActivityYard } from './cityMesh';
import { createCivilian, CIVILIAN_NAMES, type CivilianName } from './civilians';
import type { SkinnedHandle } from './skinnedModel';

type Role = 'kid' | 'talk' | 'walk';

interface Figure {
  body: SkinnedHandle;
  yard: ActivityYard;
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
type Point = readonly [number, number];
interface Layout {
  center: Point;
  play: typeof PLAY | null;
  talk: readonly Point[];
  path: readonly [Point, Point];
  ground: number;
}

/** Точки в тех же локальных осях, что предметы двора; маршруты обходят клумбы и скамейки. */
const APARTMENT: Layout = { center: [-0.5, -0.5], play: PLAY, talk: TALK, path: [[PATH.u0, PATH.f], [PATH.u1, PATH.f]], ground: GROUND };
const HOUSE: readonly Layout[] = [
  { center: [0, 0], play: { u0: -0.07, u1: 0.01, f0: -0.3, f1: -0.1 }, talk: [], path: [[0.1, 0.06], [0.1, 0.4]], ground: GROUND + 0.002 },
  { center: [0, 0], play: null, talk: [], path: [[0.1, 0.06], [0.1, 0.4]], ground: GROUND + 0.002 },
  { center: [0, 0], play: null, talk: [[-0.18, 0.2], [-0.06, 0.2]], path: [[0.18, -0.1], [0.18, 0.35]], ground: GROUND + 0.003 },
];
const PLAZA: Layout = { center: [0, 0], play: null, talk: [[-0.06, -0.19], [0.06, -0.19]], path: [[-0.4, 0.11], [0.4, 0.11]], ground: GROUND };
const layout = (yard: ActivityYard): Layout => yard.kind === 'apartment' ? APARTMENT : yard.kind === 'house' ? HOUSE[yard.variant % 3] : PLAZA;
/** Насколько далеко от точки взгляда камеры дворы оживают. */
const RANGE = 9;
/** Как часто пересматривать, какие дворы оживлять (секунды). */
const RETHINK = 1;

const rand = Math.random;
const between = (a: number, b: number) => a + rand() * (b - a);

export class YardLife {
  readonly group = new THREE.Group();
  private yards: ActivityYard[] = [];
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
      this.yards = activityYards(w);
      const yards = new Map(this.yards.map((y) => [y.root, y]));
      this.clear((f) => {
        const yard = yards.get(f.yard.root);
        if (!yard || yard.kind !== f.yard.kind || yard.variant !== f.yard.variant || yard.mirror !== f.yard.mirror) return true;
        f.yard = yard;
        return false;
      });
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
  private crowd(hour: number, yard: ActivityYard): [number, number, number] {
    if (hour < 8 || hour >= 21) return [0, 0, 0];
    if (yard.kind === 'house') return [layout(yard).play && hour >= 10 && hour < 19 ? 1 : 0, layout(yard).talk.length && hour < 19 ? 2 : 0, 1];
    if (yard.kind === 'plaza') return [0, hour < 19 ? 2 : 0, 1];
    // У каждого двора свой состав, чтобы дворы не были одинаковыми
    const k = yard.root % 3;
    if (hour >= 10 && hour < 19) return [1 + (k > 0 ? 1 : 0), k === 1 ? 0 : 2, k === 2 ? 0 : 1];
    if (hour >= 8 && hour < 21) return [0, k === 0 ? 2 : 0, 1];
    return [0, 0, 0];
  }

  /** Оживить дворы ближе к камере в пределах бюджета, остальные опустошить. */
  private rethink(hour: number, focus: { x: number; z: number }, danger: { x: number; z: number }[], alarm: boolean) {
    const center = (y: ActivityYard) => { const [u, f] = layout(y).center; return y.at(u * y.mirror, f); };
    const quiet = (y: ActivityYard) => {
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
      const c = this.crowd(hour, y);
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

  private spawn(yard: ActivityYard, role: Role, same: Figure[]) {
    const names: readonly CivilianName[] = role === 'kid' ? ['casual', 'hoodie'] : CIVILIAN_NAMES;
    const body = createCivilian(names[Math.floor(rand() * names.length)]);
    if (!body) return;
    if (role === 'kid') body.object.scale.setScalar(CHILD_SCALE);
    this.group.add(body.object);
    const site = layout(yard);
    let [u, f] = site.path[0];
    if (role === 'kid' && site.play) [u, f] = [between(site.play.u0, site.play.u1), between(site.play.f0, site.play.f1)];
    if (role === 'talk') [u, f] = site.talk[same.length % site.talk.length];
    if (role === 'walk') {
      const t = rand(), [a, b] = site.path;
      [u, f] = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    }
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
      const site = layout(fig.yard);
      if (fig.role === 'kid' && site.play) [fig.tu, fig.tf] = [between(site.play.u0, site.play.u1), between(site.play.f0, site.play.f1)];
      else {
        const [a, b] = site.path;
        [fig.tu, fig.tf] = Math.hypot(fig.u - a[0], fig.f - a[1]) < Math.hypot(fig.u - b[0], fig.f - b[1]) ? b : a;
      }
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
    fig.body.object.position.set(x, layout(fig.yard).ground + 0.003, z);
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
