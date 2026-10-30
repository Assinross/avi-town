// Отрисовка тактического боя поверх улицы: контур зоны, туман войны, клетки хода,
// фигурки бойцов и пришельцев (модели со скелетной анимацией), подписи с полосками
// здоровья (HTML поверх canvas).

import * as THREE from 'three';
import { ALIEN_BY_ID, COVER_BY_ID, t } from '@avi/data';
import { CELLS, distances, hasAdjacentCover, moveCost, visibleCells, type CoverProp, type Fx, type Mission, type PropState, type TacUnit } from '@avi/sim';
import { createCharacter, type CharacterHandle, type CharacterName } from './characters';
import { createPropView, disposePropView } from './battleProps';

const CELL = 1 / CELLS;
/** Высота фигуры над землёй: ноги модели стоят на нуле. */
const FOOT = 0.02;

/** Запасная фигура из коробок - если модели не загрузились. */
function boxes(u: TacUnit): THREE.Group {
  const g = new THREE.Group();
  const lambert = (c: number | string) => new THREE.MeshLambertMaterial({ color: c });
  if (u.side === 'xcom') {
    const armor = lambert(u.personal ? 0x3fa7d6 : 0x56708a);
    const legs = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.1, 0.05), lambert(0x2e3640));
    legs.position.y = 0.05;
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.1, 0.06), armor);
    body.position.y = 0.15;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.032, 8, 6), lambert(0xe0b48a));
    head.position.y = 0.23;
    const helmet = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.03, 0.07), armor);
    helmet.position.y = 0.255;
    const rifle = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.02, 0.14), lambert(0x222222));
    rifle.position.set(0.05, 0.15, 0.04);
    g.add(legs, body, head, helmet, rifle);
  } else {
    const def = ALIEN_BY_ID[u.kind];
    const skin = lambert(def?.color ?? '#9aa3a8');
    const big = u.kind === 'Muton' || u.kind === 'SectoidCommander' ? 1.25 : 1;
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.15, 0.05), skin);
    body.position.y = 0.075;
    const head = new THREE.Mesh(new THREE.SphereGeometry(u.kind.startsWith('Sectoid') ? 0.06 : 0.04, 10, 8), skin);
    head.position.y = 0.2;
    const eye = new THREE.MeshBasicMaterial({ color: 0x111111 });
    for (const dx of [-0.022, 0.022]) {
      const e = new THREE.Mesh(new THREE.BoxGeometry(0.018, 0.012, 0.01), eye);
      e.position.set(dx, 0.21, 0.05);
      g.add(e);
    }
    const gun = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.02, 0.1), new THREE.MeshBasicMaterial({ color: 0x7dff6a }));
    gun.position.set(0.045, 0.1, 0.04);
    g.add(body, head, gun);
    g.scale.setScalar(big);
  }
  return g;
}

/** Кто из моделей набора достаётся юниту: пришельцу - пришелец, бойцам - солдат и хазмат по очереди. */
function modelFor(u: TacUnit, index: number): CharacterName {
  if (u.side === 'alien') return 'enemy';
  return index % 2 === 0 ? 'soldier' : 'hazmat';
}

/** Общие ресурсы запасных коробок: геометрия по высоте, материал по укрытию. */
const BOX_GEO = new Map<number, THREE.BoxGeometry>();
const BOX_MAT = new Map<number, THREE.MeshLambertMaterial>();

/** Запасная коробка укрытия - если модель пропса не загрузилась. Геометрия и материал общие, не на каждый пропс. */
function propBox(p: CoverProp): THREE.Mesh {
  const def = COVER_BY_ID[p.kind];
  const height = def?.height ?? 0.12;
  const cover = def?.cover ?? 20;
  let geo = BOX_GEO.get(height);
  if (!geo) {
    geo = new THREE.BoxGeometry(0.2, height, 0.2).translate(0, height / 2, 0);
    BOX_GEO.set(height, geo);
  }
  let mat = BOX_MAT.get(cover);
  if (!mat) {
    mat = new THREE.MeshLambertMaterial({ color: cover === 40 ? 0x6b4a2f : 0x9a7b52 });
    BOX_MAT.set(cover, mat);
  }
  const mesh = new THREE.Mesh(geo, mat);
  mesh.userData.noOutline = true;
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  return mesh;
}

interface UnitVis {
  obj: THREE.Group;
  char: CharacterHandle | null;
  shadow: THREE.Mesh;
  label: HTMLDivElement;
  alive: boolean;
  /** До какого времени играет разовая анимация (стрельба, попадание) - базовая её не перебивает. */
  busyUntil: number;
  /** Куда смотреть во время разовой анимации (мировые координаты, не боевые клетки). */
  face: { x: number; z: number } | null;
}

export class TacticalView {
  readonly group = new THREE.Group();
  private mission: Mission | null = null;
  private units = new Map<number, UnitVis>();
  private props = new Map<number, { obj: THREE.Object3D; state: PropState }>();
  private fog: THREE.InstancedMesh;
  private range: THREE.InstancedMesh;
  private border: THREE.LineSegments | null = null;
  private ring: THREE.Mesh;
  private shadowGeo: THREE.CircleGeometry;
  private shadowMat: THREE.MeshBasicMaterial;
  private tmp = new THREE.Object3D();
  private color = new THREE.Color();
  private visRevision = -1;
  private time = 0;
  vis: Uint8Array = new Uint8Array(0);
  selected = 0;

  constructor(private labelLayer: HTMLElement) {
    const quad = new THREE.PlaneGeometry(CELL, CELL).rotateX(-Math.PI / 2);
    const tile = new THREE.PlaneGeometry(CELL * 0.86, CELL * 0.86).rotateX(-Math.PI / 2);
    const max = 40 * 40;
    this.fog = new THREE.InstancedMesh(quad, new THREE.MeshBasicMaterial({ color: 0x0b1420, transparent: true, opacity: 0.55, depthWrite: false }), max);
    this.range = new THREE.InstancedMesh(tile, new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.45, depthWrite: false }), max);
    for (const m of [this.fog, this.range]) {
      m.count = 0;
      m.frustumCulled = false;
      m.userData.noOutline = true;
      this.group.add(m);
    }
    this.fog.renderOrder = 3;
    this.range.renderOrder = 4;
    this.ring = new THREE.Mesh(new THREE.RingGeometry(0.09, 0.115, 24).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x4fc3ff }));
    this.ring.visible = false;
    this.ring.userData.noOutline = true;
    this.group.add(this.ring);
    this.shadowGeo = new THREE.CircleGeometry(0.085, 14).rotateX(-Math.PI / 2);
    this.shadowMat = new THREE.MeshBasicMaterial({ color: 0x0a0d12, transparent: true, opacity: 0.32, depthWrite: false });
  }

  /** Центр боевой клетки в координатах сцены. */
  cellPos(m: Mission, x: number, y: number, h = 0.07) {
    return new THREE.Vector3((m.ox + x + 0.5) * CELL, h, (m.oy + y + 0.5) * CELL);
  }

  /**
   * Базовая поза юнита: движение (шаг в разведке, бег в бою), наблюдение, присед за
   * укрытием, покой. Одно правило и для цикла, и для возврата после разовой анимации.
   */
  private basePose(m: Mission, u: TacUnit, moving: boolean): string {
    if (moving) return m.phase === 'explore' ? 'Walk' : 'Run';
    if (u.overwatch) return 'Idle';
    return u.hunkered || hasAdjacentCover(m, u) ? 'Duck' : 'Idle';
  }

  private clear() {
    for (const v of this.units.values()) {
      v.char?.dispose();
      this.group.remove(v.obj);
      this.group.remove(v.shadow);
      v.label.remove();
    }
    this.units.clear();
    for (const v of this.props.values()) disposePropView(v.obj);
    this.props.clear();
    if (this.border) this.group.remove(this.border);
    this.border = null;
    this.fog.count = 0;
    this.range.count = 0;
    this.ring.visible = false;
  }

  private build(m: Mission) {
    this.clear();
    this.time = 0;
    const x0 = m.ox * CELL, z0 = m.oy * CELL, x1 = (m.ox + m.w) * CELL, z1 = (m.oy + m.h) * CELL, y = 0.06;
    const pts = [[x0, z0], [x1, z0], [x1, z0], [x1, z1], [x1, z1], [x0, z1], [x0, z1], [x0, z0]].map(([x, z]) => new THREE.Vector3(x, y, z));
    this.border = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: 0x4fc3ff }));
    this.border.userData.noOutline = true;
    this.group.add(this.border);
    m.units.forEach((u, i) => {
      const obj = new THREE.Group();
      const char = createCharacter(modelFor(u, i));
      obj.add(char ? char.object : boxes(u));
      const shadow = new THREE.Mesh(this.shadowGeo, this.shadowMat);
      shadow.userData.noOutline = true;
      this.group.add(obj, shadow);
      const label = document.createElement('div');
      label.className = `unit-label ${u.side}`;
      label.style.display = 'none';
      this.labelLayer.appendChild(label);
      this.units.set(u.id, { obj, char, shadow, label, alive: u.hp > 0, busyUntil: 0, face: null });
    });
    this.syncProps(m);
  }

  /** Синхронизировать пропсы-укрытия: добавить новые, заменить сменившие состояние, убрать исчезнувшие. */
  private syncProps(m: Mission) {
    const seen = new Set<number>();
    for (const p of m.props) {
      seen.add(p.id);
      const cur = this.props.get(p.id);
      if (cur && cur.state === p.state) continue;
      if (cur) disposePropView(cur.obj);
      const obj = createPropView(p) ?? propBox(p);
      obj.position.copy(this.cellPos(m, p.cell % m.w, Math.floor(p.cell / m.w), 0));
      obj.rotation.y = ((p.id * 7) % 4) * Math.PI / 2;
      this.group.add(obj);
      this.props.set(p.id, { obj, state: p.state });
    }
    for (const [id, v] of this.props) {
      if (seen.has(id)) continue;
      disposePropView(v.obj);
      this.props.delete(id);
    }
  }

  update(m: Mission | null, revision: number, camera: THREE.Camera, dt: number, hover: { x: number; y: number } | null, fx: readonly Fx[] = []) {
    if (m !== this.mission) {
      this.mission = m;
      if (m) this.build(m);
      else this.clear();
      this.visRevision = -1;
    }
    if (!m) return;
    this.time += dt;
    if (this.vis.length !== m.w * m.h) this.vis = new Uint8Array(m.w * m.h);
    if (this.visRevision !== revision) {
      this.visRevision = revision;
      this.vis = visibleCells(m);
      this.rebuildOverlays(m);
      this.syncProps(m);
    }
    // Выстрелы: стрелок вскидывает оружие, цель вздрагивает (смерть - по состоянию здоровья)
    for (const e of fx) {
      if (e.type !== 'tacShot') continue;
      const shooter = this.units.get(e.fromId);
      if (shooter && shooter.alive) {
        shooter.char?.once('Idle_Shoot');
        shooter.busyUntil = this.time + 1.1;
        // Стрелок разворачивается на цель: координаты эффекта - 1/100 клетки города
        shooter.face = { x: e.toX / 100, z: e.toY / 100 };
      }
      const target = this.units.get(e.toId);
      if (target && target.alive) {
        target.char?.once('HitReact');
        target.busyUntil = this.time + 0.5;
      }
    }
    const w = window.innerWidth, h = window.innerHeight;
    for (const u of m.units) {
      const v = this.units.get(u.id)!;
      const seen = u.side === 'xcom' || this.vis[u.y * m.w + u.x] === 1;
      const target = this.cellPos(m, u.x, u.y, FOOT);
      const step = target.clone().sub(v.obj.position);
      const moving = step.lengthSq() > 1e-6;
      const dead = u.hp <= 0;
      const pose = this.basePose(m, u, moving);

      // Смена состояния: жив/мёртв
      if (dead && v.alive) {
        v.alive = false;
        v.char?.once('Death', true);
      } else if (!dead && !v.alive) {
        v.alive = true;
        v.char?.loop(pose);
      }

      if (dead) {
        // Выбывший остаётся там, где упал: пришелец убит, боец XCOM тяжело ранен
        v.obj.position.lerp(target, Math.min(1, dt * 10));
      } else {
        if (v.busyUntil > this.time && v.face) {
          const f = new THREE.Vector3(v.face.x, 0, v.face.z).sub(v.obj.position);
          if (f.lengthSq() > 1e-6) v.obj.rotation.y = Math.atan2(f.x, f.z);
        } else if (moving) {
          v.obj.rotation.y = Math.atan2(step.x, step.z);
        }
        v.obj.position.lerp(target, Math.min(1, dt * 10));
        if (this.time >= v.busyUntil) {
          v.face = null;
          v.char?.loop(pose);
        }
      }
      v.char?.update(dt);
      v.shadow.position.copy(v.obj.position).setY(FOOT - 0.005);
      v.shadow.visible = seen;

      v.obj.visible = seen;
      const p = v.obj.position.clone();
      p.y += 0.34;
      p.project(camera);
      // Над тяжело раненым бойцом подпись остаётся - видно, что он жив и выбыл до конца боя
      // p.z > 1 - точка позади перспективной камеры: её проекция зеркальна, подпись прячем
      v.label.style.display = seen && p.z < 1 && (!dead || u.side === 'xcom') ? 'flex' : 'none';
      v.label.style.transform = `translate(${((p.x + 1) / 2) * w}px, ${((1 - p.y) / 2) * h}px) translate(-50%, -100%)`;
      const name = u.side === 'xcom' ? u.name.replace(' (вы)', '') : t(u.name);
      const watch = u.overwatch ? '<b class="unit-mark watch">◉</b>' : '';
      const duck = pose === 'Duck' ? '<b class="unit-mark duck">▼</b>' : '';
      v.label.innerHTML = dead
        ? `<span>${name}</span><em class="unit-down">✚ тяжёлое ранение</em>`
        : `<span>${name}${watch}${duck}</span><i style="width:${(u.hp * 100) / u.maxHp}%"></i>`;
      v.label.classList.toggle('selected', u.id === this.selected);
    }
    const sel = m.units.find((u) => u.id === this.selected && u.hp > 0);
    this.ring.visible = !!sel;
    if (sel) this.ring.position.copy(this.units.get(sel.id)!.obj.position).setY(FOOT + 0.005);
    void hover;
  }

  /** Перестроить туман и клетки хода выбранного бойца. */
  rebuildOverlays(m: Mission) {
    let n = 0;
    for (let y = 0; y < m.h; y++) {
      for (let x = 0; x < m.w; x++) {
        if (this.vis[y * m.w + x]) continue;
        this.tmp.position.copy(this.cellPos(m, x, y, 0.08));
        this.tmp.updateMatrix();
        this.fog.setMatrixAt(n++, this.tmp.matrix);
      }
    }
    this.fog.count = n;
    this.fog.instanceMatrix.needsUpdate = true;

    n = 0;
    const sel = m.units.find((u) => u.id === this.selected && u.hp > 0 && u.side === 'xcom');
    if (sel && m.phase === 'turn' && sel.ap > 0) {
      const d = distances(m, sel);
      for (let y = 0; y < m.h; y++) {
        for (let x = 0; x < m.w; x++) {
          const cost = moveCost(m, sel, x, y, d);
          if (cost < 0 || cost > sel.ap) continue;
          this.tmp.position.copy(this.cellPos(m, x, y, 0.075));
          this.tmp.updateMatrix();
          this.range.setMatrixAt(n, this.tmp.matrix);
          this.range.setColorAt(n, this.color.setHex(cost === 1 ? 0x4fc3ff : 0xffd66b));
          n++;
        }
      }
    }
    this.range.count = n;
    this.range.instanceMatrix.needsUpdate = true;
    if (this.range.instanceColor) this.range.instanceColor.needsUpdate = true;
  }

  /** Боевая клетка под точкой сцены. */
  cellAt(m: Mission, worldX: number, worldZ: number): { x: number; y: number } | null {
    const x = Math.floor(worldX * CELLS) - m.ox, y = Math.floor(worldZ * CELLS) - m.oy;
    return x >= 0 && y >= 0 && x < m.w && y < m.h ? { x, y } : null;
  }
}
