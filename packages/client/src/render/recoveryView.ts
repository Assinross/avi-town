// Выезд службы восстановления, ограждение и работа бригады.
// Только отображение: сроки расчистки и восстановление зон остаются в sim/recovery.ts.

import * as THREE from 'three';
import { BUILDING_BY_ID, RECOVERY } from '@avi/data';
import { SPEED_FACTOR, type World, type RecoverySite } from '@avi/sim';
import { GeoBuilder } from './builder';
import { roadTop } from './cityMap';
import { vanGeometry } from './vehicles';

const MAX_VISIBLE = 16;
const ROAD_ACCESS = RECOVERY.roadAccessRadius;

type Phase = 'out' | 'work' | 'return';
interface VehicleSite {
  id: number;
  office: number;
  footprint: string;
  path: number[];
  progress: number;
  phase: Phase;
  roadCell: number;
  parent: THREE.Group;
  van: THREE.Mesh;
  tape: THREE.Mesh;
  worker: THREE.Mesh;
  dust: THREE.Mesh[];
  center: { x: number; z: number };
}

function neighbors(w: World, cell: number): number[] {
  const x = cell % w.size, y = Math.floor(cell / w.size);
  return [x > 0 ? cell - 1 : -1, x < w.size - 1 ? cell + 1 : -1,
    y > 0 ? cell - w.size : -1, y < w.size - 1 ? cell + w.size : -1]
    .filter((i) => i >= 0 && w.tiles[i].object === 'road' && !!w.explored[i]);
}

function roadsNear(w: World, cells: number[], radius: number): number[] {
  const found = new Set<number>();
  for (const cell of cells) {
    const x = cell % w.size, y = Math.floor(cell / w.size);
    for (let dy = -radius; dy <= radius; dy++) for (let dx = -radius; dx <= radius; dx++) {
      if (Math.abs(dx) + Math.abs(dy) > radius) continue;
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= w.size || ny >= w.size) continue;
      const index = ny * w.size + nx;
      if (w.tiles[index].object === 'road' && w.explored[index]) found.add(index);
    }
  }
  return [...found].sort((a, b) => a - b);
}

/** Кратчайшая цепочка дорожных клеток: без телепортации через разорванные улицы. */
function route(w: World, site: RecoverySite): number[] {
  if (site.officeRoot === null) return [];
  const officeSize = BUILDING_BY_ID[RECOVERY.officeId].size;
  const x = site.officeRoot % w.size, y = Math.floor(site.officeRoot / w.size);
  const officeCells: number[] = [];
  for (let dz = 0; dz < officeSize; dz++) for (let dx = 0; dx < officeSize; dx++) {
    const ox = x + dx, oy = y + dz;
    if (ox < w.size && oy < w.size) officeCells.push(oy * w.size + ox);
  }
  const starts = roadsNear(w, officeCells, 1);
  const goals = new Set(roadsNear(w, site.cells, ROAD_ACCESS));
  if (!starts.length || !goals.size) return [];
  const previous = new Int32Array(w.tiles.length).fill(-1);
  const queue = [...starts];
  for (const start of starts) previous[start] = start;
  let end = -1;
  for (let i = 0; i < queue.length; i++) {
    const cell = queue[i];
    if (goals.has(cell)) { end = cell; break; }
    for (const next of neighbors(w, cell)) {
      if (previous[next] >= 0) continue;
      previous[next] = cell;
      queue.push(next);
    }
  }
  if (end < 0) return [];
  const path = [end];
  while (previous[path[0]] !== path[0]) path.unshift(previous[path[0]]);
  return path;
}

/** Лента по внешним краям завала, а не между клетками одного разрушенного здания. */
function tapeGeometry(w: World, cells: number[]): THREE.BufferGeometry {
  const g = new GeoBuilder();
  const occupied = new Set(cells);
  const yellow = 0xf2c646, black = 0x303536, post = 0x6e7376;
  for (const cell of cells) {
    const x = cell % w.size, z = Math.floor(cell / w.size);
    for (const [dx, dz] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) {
      const nx = x + dx, nz = z + dz;
      if (nx >= 0 && nz >= 0 && nx < w.size && nz < w.size && occupied.has(nz * w.size + nx)) continue;
      const alongX = dz !== 0;
      const centerX = x + 0.5 + dx * 0.44, centerZ = z + 0.5 + dz * 0.44;
      for (let part = 0; part < 6; part++) {
        const offset = (part - 2.5) * 0.145;
        g.box(centerX + (alongX ? offset : 0), 0.145, centerZ + (alongX ? 0 : offset),
          alongX ? 0.146 : 0.012, 0.022, alongX ? 0.012 : 0.146,
          part % 2 ? black : yellow);
      }
      for (const side of [-1, 1]) {
        g.box(centerX + (alongX ? side * 0.435 : 0), 0,
          centerZ + (alongX ? 0 : side * 0.435), 0.023, 0.17, 0.023, post);
      }
    }
  }
  return g.build();
}

function workerGeometry(): THREE.BufferGeometry {
  const g = new GeoBuilder();
  g.box(-0.022, 0, 0, 0.031, 0.085, 0.035, 0x45525b);
  g.box(0.022, 0, 0, 0.031, 0.085, 0.035, 0x45525b);
  g.box(0, 0.086, 0, 0.09, 0.105, 0.05, 0xf0a936);
  g.box(0, 0.192, 0, 0.052, 0.055, 0.052, 0xb99074);
  g.box(0, 0.245, 0, 0.078, 0.022, 0.078, 0xf8d54f);
  return g.build();
}

export class RecoveryView {
  readonly group = new THREE.Group();
  private readonly material = new THREE.MeshLambertMaterial({ vertexColors: true });
  private readonly dustMaterial = new THREE.MeshLambertMaterial({
    color: 0xb5aa94, transparent: true, opacity: 0.55, depthWrite: false,
  });
  private readonly vanGeo = vanGeometry(0, 0xe9bb39);
  private readonly workerGeo = workerGeometry();
  private readonly dustGeo = new THREE.IcosahedronGeometry(0.065, 0);
  private readonly sites = new Map<number, VehicleSite>();
  private world: World | null = null;
  private revision = -1;
  private elapsed = 0;

  reset() {
    for (const visual of this.sites.values()) this.drop(visual);
    this.sites.clear();
    this.world = null;
    this.revision = -1;
    this.elapsed = 0;
  }

  /** Автомобили уступают коммунальной машине на её текущей дорожной клетке. */
  occupiesRoad(cell: number): boolean {
    for (const site of this.sites.values()) {
      if (site.phase !== 'work' && site.roadCell === cell) return true;
    }
    return false;
  }

  private drop(site: VehicleSite) {
    this.group.remove(site.parent);
    site.tape.geometry.dispose();
  }

  private create(w: World, site: RecoverySite, path: number[]): VehicleSite {
    const first = site.cells[0];
    const center = { x: first % w.size + 0.5, z: Math.floor(first / w.size) + 0.5 };
    const parent = new THREE.Group();
    const van = new THREE.Mesh(this.vanGeo, this.material);
    van.castShadow = true;
    van.receiveShadow = true;
    const tape = new THREE.Mesh(tapeGeometry(w, site.cells), this.material);
    tape.visible = false;
    const worker = new THREE.Mesh(this.workerGeo, this.material);
    worker.position.set(center.x + 0.19, 0.03, center.z + 0.1);
    worker.visible = false;
    worker.castShadow = true;
    const dust = [0, 1, 2].map(() => {
      const m = new THREE.Mesh(this.dustGeo, this.dustMaterial);
      m.visible = false;
      m.userData.noOutline = true;
      parent.add(m);
      return m;
    });
    parent.add(van, tape, worker);
    this.group.add(parent);
    return {
      id: site.id, office: site.officeRoot!, footprint: site.cells.join(','),
      path, progress: 0, phase: 'out', roadCell: path[0],
      parent, van, tape, worker, dust, center,
    };
  }

  private reconcile(w: World) {
    if (this.world !== w) this.reset();
    if (this.revision === w.revision) return;
    this.world = w;
    this.revision = w.revision;
    const active = new Set<number>();
    for (const site of w.recoverySites) {
      if (site.status !== 'clearing' || site.officeRoot === null || active.size >= MAX_VISIBLE) continue;
      active.add(site.id);
      const existing = this.sites.get(site.id);
      if (existing && existing.office === site.officeRoot &&
          existing.footprint === site.cells.join(',') &&
          existing.phase !== 'return' &&
          existing.path.every((index) => w.tiles[index].object === 'road')) continue;
      if (existing) { this.drop(existing); this.sites.delete(site.id); }
      const path = route(w, site);
      if (path.length) this.sites.set(site.id, this.create(w, site, path));
    }
    for (const visual of this.sites.values()) {
      if (active.has(visual.id)) continue;
      visual.phase = 'return';
      visual.tape.visible = false;
      visual.worker.visible = false;
      visual.dust.forEach((p) => { p.visible = false; });
    }
  }

  private move(w: World, site: VehicleSite) {
    const last = site.path.length - 1;
    const value = THREE.MathUtils.clamp(site.progress, 0, last);
    const index = Math.min(last, Math.floor(value));
    const next = Math.min(last, index + 1);
    const a = site.path[index], b = site.path[next];
    const mix = value - index;
    const ax = a % w.size + 0.5, az = Math.floor(a / w.size) + 0.5;
    const bx = b % w.size + 0.5, bz = Math.floor(b / w.size) + 0.5;
    site.van.position.set(THREE.MathUtils.lerp(ax, bx, mix), roadTop() + 0.015,
      THREE.MathUtils.lerp(az, bz, mix));
    site.roadCell = mix >= 0.5 ? b : a;
    const before = site.path[Math.max(0, index - 1)];
    let dx = bx - ax, dz = bz - az;
    if (dx === 0 && dz === 0) {
      dx = (b % w.size) - (before % w.size);
      dz = Math.floor(b / w.size) - Math.floor(before / w.size);
    }
    if (dx !== 0 || dz !== 0) {
      site.van.rotation.y = Math.atan2(dx, dz) + (site.phase === 'return' ? Math.PI : 0);
    }
  }

  update(w: World, dt: number) {
    this.reconcile(w);
    this.group.visible = !w.mission;
    if (!this.group.visible) return;
    const speed = w.over ? 0 : Math.min(3, SPEED_FACTOR[w.speed]);
    if (speed > 0) this.elapsed += dt * speed;
    for (const [id, site] of this.sites) {
      const length = Math.max(0, site.path.length - 1);
      const driveSpeed = Math.max(0.65, length / 7);
      if (speed > 0) {
        if (site.phase === 'out') {
          site.progress = Math.min(length, site.progress + dt * speed * driveSpeed);
          if (site.progress >= length) site.phase = 'work';
        } else if (site.phase === 'return') {
          site.progress = Math.max(0, site.progress - dt * speed * driveSpeed);
          if (site.progress <= 0) {
            this.drop(site);
            this.sites.delete(id);
            continue;
          }
        }
      }
      this.move(w, site);
      const working = site.phase === 'work';
      site.tape.visible = working;
      site.worker.visible = working;
      if (working) {
        site.worker.rotation.y = Math.sin(this.elapsed * 2 + id) * 0.45;
        site.worker.position.y = 0.025 + Math.sin(this.elapsed * 5 + id) * 0.01;
      }
      site.dust.forEach((p, n) => {
        p.visible = working && speed > 0;
        if (!p.visible) return;
        const t = (this.elapsed * 0.45 + n / site.dust.length + id * 0.11) % 1;
        p.position.set(site.center.x + Math.sin(n * 2.3) * (0.08 + t * 0.18),
          0.08 + t * 0.3, site.center.z + Math.cos(n * 2.3) * (0.08 + t * 0.18));
        p.scale.setScalar(0.65 + t * 1.15);
      });
    }
  }
}
