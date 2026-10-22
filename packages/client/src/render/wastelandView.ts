// Пустошь на карте: броневик отряда в пути, группы разведчиков, гнёзда пришельцев и значки
// находок. Броневик и разведчики плавно догоняют свои позиции из симуляции; значки - подписи
// в слое #labels поверх холста, как подписи бойцов в бою.

import * as THREE from 'three';
import type { SiteKind } from '@avi/data';
import { convoyStepTicks, type Convoy, type Expedition, type World } from '@avi/sim';
import { GeoBuilder } from './builder';
import { CAR_LANE, roadTop } from './cityMap';
import { PALETTE } from './palette';

export const SITE_ICON: Record<SiteKind, string> = {
  metal: '⛏', spring: '💧', cache: '📦', archive: '📜', survivors: '🧑‍🤝‍🧑', radiation: '☢', nest: '👾',
};
export const SITE_NAME: Record<SiteKind, string> = {
  metal: 'Залежь металла', spring: 'Чистый источник', cache: 'Тайник', archive: 'Довоенный архив',
  survivors: 'Выжившие', radiation: 'Радиоактивное пятно', nest: 'Гнездо пришельцев',
};

/** Броневик: зелёный корпус на шести колёсах, башенка, жёлтая полоса и фара. */
function apcGeometry(): THREE.BufferGeometry {
  const g = new GeoBuilder();
  const top = roadTop();
  g.box(0, top + 0.035, 0, 0.17, 0.09, 0.36, PALETTE.military, 0, 0x6d7a4f);
  g.box(0, top + 0.125, -0.03, 0.12, 0.05, 0.16, PALETTE.military);
  g.box(0, top + 0.145, 0.07, 0.025, 0.025, 0.14, PALETTE.metal[1]);
  g.box(0, top + 0.09, 0.181, 0.13, 0.02, 0.004, PALETTE.hazard);
  for (const z of [-0.12, 0, 0.12]) for (const x of [-0.09, 0.09]) g.box(x, top, z, 0.03, 0.06, 0.06, 0x222222);
  return g.build();
}

/** Разведчик: фигурка в хаки с рюкзаком. */
function scoutGeometry(): THREE.BufferGeometry {
  const g = new GeoBuilder();
  const top = roadTop();
  g.box(0, top, 0, 0.05, 0.1, 0.04, PALETTE.military);
  g.box(0, top + 0.1, 0, 0.035, 0.035, 0.035, 0xd9b48f);
  g.box(0, top + 0.05, -0.03, 0.04, 0.05, 0.025, PALETTE.sandbag);
  return g.build();
}

/** Гнездо: сросшиеся купола фиолетовой плоти и светящиеся споры. */
function nestGroup(): THREE.Group {
  const g = new THREE.Group();
  const flesh = new THREE.MeshLambertMaterial({ color: 0x6b3a7a });
  const glow = new THREE.MeshBasicMaterial({ color: 0xc86bff });
  for (const [x, z, r] of [[0, 0, 0.3], [0.22, 0.12, 0.18], [-0.18, 0.16, 0.16], [0.05, -0.24, 0.14]] as const) {
    const m = new THREE.Mesh(new THREE.SphereGeometry(r, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), flesh);
    m.position.set(x, 0, z);
    g.add(m);
  }
  for (let i = 0; i < 5; i++) {
    const s = new THREE.Mesh(new THREE.SphereGeometry(0.035, 6, 4), glow);
    s.position.set(Math.cos(i * 1.3) * 0.25, 0.12 + (i % 3) * 0.05, Math.sin(i * 1.3) * 0.25);
    g.add(s);
  }
  return g;
}

interface Marker { el: HTMLDivElement; x: number; y: number; z: number }

export class WastelandView {
  readonly group = new THREE.Group();
  private material = new THREE.MeshLambertMaterial({ vertexColors: true });
  private apc: THREE.Mesh;
  private apcPos = new THREE.Vector3();
  private apcShown = false;
  private scoutGeo = scoutGeometry();
  private scouts = new Map<number, { obj: THREE.Group; pos: THREE.Vector3 }>();
  private nests = new Map<number, THREE.Group>();
  private markers = new Map<string, Marker>();
  private time = 0;

  constructor(private labelLayer: HTMLElement) {
    this.apc = new THREE.Mesh(apcGeometry(), this.material);
    // Чуть крупнее легковушки: броневик видно на общем плане
    this.apc.scale.setScalar(1.3);
    this.apc.castShadow = true;
    this.apc.visible = false;
    this.group.add(this.apc);
  }

  /** Новый мир: всё убирается и строится заново. */
  reset() {
    for (const s of this.scouts.values()) this.group.remove(s.obj);
    this.scouts.clear();
    for (const n of this.nests.values()) this.group.remove(n);
    this.nests.clear();
    for (const m of this.markers.values()) m.el.remove();
    this.markers.clear();
    this.apcShown = false;
  }

  /** Броневик сейчас: клетка маршрута, где он (cell), для пропуска машинами. */
  convoyCells(w: World): number[] {
    const c = w.convoy;
    if (!c) return [];
    return [c.path[c.seg], c.path[Math.min(c.path.length - 1, c.seg + 1)]];
  }

  update(w: World, camera: THREE.Camera, dt: number, detector: boolean) {
    this.time += dt;
    const battle = !!w.mission;
    this.group.visible = !battle;
    const seen = new Set<string>();
    this.updateConvoy(w, dt);
    this.updateScouts(w, dt, seen);
    // Гнёзда - на найденных и не зачищенных местах
    for (const site of w.sites) {
      const nest = this.nests.get(site.id);
      const show = site.kind === 'nest' && site.found && !site.done;
      if (show && !nest) {
        const g = nestGroup();
        g.position.set(site.x + 0.5, 0, site.y + 0.5);
        this.nests.set(site.id, g);
        this.group.add(g);
      } else if (!show && nest) {
        this.group.remove(nest);
        this.nests.delete(site.id);
      }
      if (show) this.nests.get(site.id)!.children.forEach((c, i) => { if (i >= 4) c.position.y = 0.12 + Math.abs(Math.sin(this.time * 2 + i)) * 0.12; });
      // Значок: найденные постоянные находки; детектор металла показывает залежи и источники под туманом
      const permanent = site.kind === 'metal' || site.kind === 'spring' || site.kind === 'radiation' || site.kind === 'nest';
      const hinted = detector && !site.found && (site.kind === 'metal' || site.kind === 'spring');
      if ((site.found && permanent && !site.done) || hinted) {
        const key = `s${site.id}`;
        seen.add(key);
        this.marker(key, site.x + 0.5, site.kind === 'nest' ? 0.55 : 0.3, site.y + 0.5, hinted ? `<b>?</b>${SITE_ICON[site.kind]}` : `${SITE_ICON[site.kind]}<span>${SITE_NAME[site.kind]}</span>`, hinted ? 'hint' : site.kind);
      }
    }
    if (w.convoy && this.apcShown) {
      seen.add('convoy');
      this.marker('convoy', this.apcPos.x, 0.45, this.apcPos.z, `🚙<span>${w.convoy.phase === 'out' ? 'Отряд в пути' : 'Возвращается'}</span>`, 'convoy');
    }
    // Подписи: позиция на экране, скрыты в бою и за краем
    const width = window.innerWidth, height = window.innerHeight;
    const p = new THREE.Vector3();
    for (const [key, m] of this.markers) {
      if (!seen.has(key)) {
        m.el.remove();
        this.markers.delete(key);
        continue;
      }
      p.set(m.x, m.y, m.z).project(camera);
      const off = battle || p.z > 1 || Math.abs(p.x) > 1.1 || Math.abs(p.y) > 1.1;
      m.el.style.display = off ? 'none' : 'flex';
      if (!off) m.el.style.transform = `translate(${((p.x + 1) / 2) * width}px, ${((1 - p.y) / 2) * height}px) translate(-50%, -100%)`;
    }
  }

  private marker(key: string, x: number, y: number, z: number, html: string, kind: string) {
    let m = this.markers.get(key);
    if (!m) {
      const el = document.createElement('div');
      el.className = `site-label ${kind}`;
      this.labelLayer.appendChild(el);
      m = { el, x, y, z };
      this.markers.set(key, m);
    }
    m.x = x;
    m.y = y;
    m.z = z;
    if (m.el.innerHTML !== html) m.el.innerHTML = html;
  }

  /** Точка на маршруте: между клеткой seg и следующей, на правой полосе, если это дорога. */
  private routePoint(w: World, path: number[], seg: number, frac: number): { x: number; z: number; yaw: number } {
    const s = w.size;
    const a = path[seg], b = path[Math.min(path.length - 1, seg + 1)];
    const ax = (a % s) + 0.5, az = Math.floor(a / s) + 0.5;
    const bx = (b % s) + 0.5, bz = Math.floor(b / s) + 0.5;
    const dx = bx - ax, dz = bz - az;
    const len = Math.hypot(dx, dz) || 1;
    let x = ax + dx * frac, z = az + dz * frac;
    // По дороге - правая полоса, как у машин
    if (w.tiles[a]?.object === 'road' && len > 0) {
      x += (-dz / len) * CAR_LANE;
      z += (dx / len) * CAR_LANE;
    }
    return { x, z, yaw: Math.atan2(dx, dz) };
  }

  private updateConvoy(w: World, dt: number) {
    const c: Convoy | null = w.convoy;
    if (!c) {
      this.apc.visible = false;
      this.apcShown = false;
      return;
    }
    const pt = this.routePoint(w, c.path, c.seg, Math.min(1, c.acc / convoyStepTicks(w, c)));
    const target = new THREE.Vector3(pt.x, 0, pt.z);
    if (!this.apcShown) this.apcPos.copy(target);
    this.apcPos.lerp(target, Math.min(1, dt * 8));
    this.apc.position.copy(this.apcPos);
    if (c.path.length > 1) {
      let diff = pt.yaw - this.apc.rotation.y;
      diff = Math.atan2(Math.sin(diff), Math.cos(diff));
      this.apc.rotation.y += diff * Math.min(1, dt * 8);
    }
    this.apc.visible = true;
    this.apcShown = true;
  }

  private updateScouts(w: World, dt: number, seen: Set<string>) {
    const alive = new Set<number>();
    for (const e of w.expeditions as Expedition[]) {
      alive.add(e.id);
      let s = this.scouts.get(e.id);
      if (!s) {
        const obj = new THREE.Group();
        e.soldiers.forEach((_, k) => {
          const m = new THREE.Mesh(this.scoutGeo, this.material);
          m.scale.setScalar(1.6);
          m.position.set(k * 0.09 - 0.045 * (e.soldiers.length - 1), 0, k * -0.06);
          m.castShadow = true;
          obj.add(m);
        });
        this.group.add(obj);
        s = { obj, pos: new THREE.Vector3() };
        const p0 = this.routePoint(w, e.path, e.seg, 0);
        s.pos.set(p0.x, 0, p0.z);
        this.scouts.set(e.id, s);
      }
      const pt = this.routePoint(w, e.path, e.seg, Math.min(1, e.acc / Math.max(1, e.ticks)));
      s.pos.lerp(new THREE.Vector3(pt.x, 0, pt.z), Math.min(1, dt * 8));
      s.obj.position.copy(s.pos);
      s.obj.rotation.y = pt.yaw;
      // Шаг: фигурки покачиваются на ходу
      s.obj.children.forEach((m, k) => { m.position.y = Math.abs(Math.sin(this.time * 9 + k)) * 0.015; });
      const key = `e${e.id}`;
      seen.add(key);
      this.marker(key, s.pos.x, 0.32, s.pos.z, `🎒<span>${e.phase === 'out' ? 'Разведка' : 'Возвращаются'}</span>`, 'scouts');
    }
    for (const [id, s] of this.scouts) {
      if (alive.has(id)) continue;
      this.group.remove(s.obj);
      this.scouts.delete(id);
    }
  }
}
