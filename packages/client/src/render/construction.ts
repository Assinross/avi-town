// Стройка в 3D (plan.md 010, этап 7; spec US7): башенный кран у каждой стройки - решётчатая мачта,
// кабина, стрела с противовесом; стрела ходит между поддонами с материалами и домом, тележка
// едет по стреле, груз на тросе опускается и поднимается. Цикл - как у крана рисованных спрайтов
// (sprites/spriteLayer.ts): поворот к дому, груз вниз-вверх, поворот обратно, снова вниз-вверх.
// У части строек у ворот стоит самосвал. Площадка, каркас и леса - в cityMesh.ts (addDetailedSite).
// На паузе всё замирает. Только при детальных домах: прежняя стройка рисует кран сама.

import * as THREE from 'three';
import { SPEED_FACTOR, type World } from '@avi/sim';
import { detailedBuildings } from './buildings';
import { GeoBuilder } from './builder';
import { constructionSites, SITE_FLOOR, type ConstructionSite } from './cityMesh';
import { PALETTE } from './palette';
import { dumpGeometry } from './vehicles';

interface Crane {
  site: ConstructionSite;
  /** Стрела с кабиной - вращается вокруг мачты. */
  head: THREE.Mesh;
  /** Тележка с тросом и грузом - едет по стреле и опускает груз. */
  hook: THREE.Group;
  cable: THREE.Mesh;
  load: THREE.Mesh;
  mast: THREE.Mesh;
  truck: THREE.Mesh | null;
  /** Откуда кран светит стрелой: поддоны и центр дома в осях от мачты. */
  pile: { a: number; r: number };
  house: { a: number; r: number };
  top: number;
  seed: number;
}

const STEEL = 0x5a5550;
/** Длительность полного цикла в единицах craneTime. */
const CYCLE = 16;

export class Construction {
  readonly group = new THREE.Group();
  private material = new THREE.MeshLambertMaterial({ vertexColors: true });
  private cranes: Crane[] = [];
  private world: World | null = null;
  private revision = -1;
  private time = 0;
  private truckGeo = dumpGeometry(0.03);
  private cableGeo = new THREE.BoxGeometry(0.006, 1, 0.006).translate(0, -0.5, 0);
  private loadGeo: THREE.BufferGeometry;

  constructor() {
    const g = new GeoBuilder();
    g.box(0, -0.05, 0, 0.1, 0.012, 0.1, PALETTE.scaffold);
    g.box(0, -0.038, 0, 0.08, 0.04, 0.08, PALETTE.brick[0]);
    g.box(0, -0.004, 0, 0.03, 0.004, 0.03, STEEL);
    this.loadGeo = g.build();
  }

  reset() {
    this.clear();
    this.world = null;
    this.revision = -1;
  }

  update(w: World, dt: number) {
    this.group.visible = !w.mission && detailedBuildings();
    if (this.world !== w || this.revision !== w.revision) {
      this.world = w;
      this.revision = w.revision;
      this.rebuild(w);
    }
    if (!this.group.visible || w.over) return;
    this.time += dt * Math.min(2, SPEED_FACTOR[w.speed]);
    for (const c of this.cranes) this.animate(c);
  }

  /** Краны заново по списку строек; у той же стройки на том же месте - тот же кран. */
  private rebuild(w: World) {
    const sites = constructionSites(w);
    const key = (s: ConstructionSite) => `${s.root}:${s.size}:${s.floors}`;
    const keep = new Map(this.cranes.map((c) => [key(c.site), c]));
    const next: Crane[] = [];
    for (const s of sites) {
      const old = keep.get(key(s));
      if (old) {
        keep.delete(key(s));
        old.site = s;
        this.place(old);
        next.push(old);
      } else next.push(this.make(s));
    }
    for (const c of keep.values()) this.drop(c);
    this.cranes = next;
  }

  private make(s: ConstructionSite): Crane {
    const final = 0.03 + s.floors * SITE_FLOOR;
    const top = final + 0.35 + s.size * 0.15;
    const jib = s.size * 0.95;
    // Мачта: четыре пояса уголком и раскосы через секцию, опорная плита
    const m = new GeoBuilder();
    m.box(0, 0, 0, 0.16, 0.03, 0.16, PALETTE.concrete[3]);
    const a = 0.028;
    for (const [x, z] of [[-a, -a], [a, -a], [a, a], [-a, a]]) m.box(x, 0.03, z, 0.01, top - 0.03, 0.01, PALETTE.crane);
    for (let y = 0.08; y < top - 0.02; y += 0.07) {
      m.box(0, y, -a, 2 * a, 0.006, 0.006, PALETTE.crane);
      m.box(0, y, a, 2 * a, 0.006, 0.006, PALETTE.crane);
      m.box(-a, y, 0, 0.006, 0.006, 2 * a, PALETTE.crane);
      m.box(a, y, 0, 0.006, 0.006, 2 * a, PALETTE.crane);
    }
    const mast = new THREE.Mesh(m.build(), this.material);
    // Поворотная часть: кабина, стрела вперёд (+z), противовесная консоль с грузами, оголовок и тяги
    const h = new GeoBuilder();
    h.box(0, 0, 0, 0.08, 0.02, 0.08, STEEL);
    h.box(0.05, -0.05, 0.03, 0.05, 0.06, 0.06, PALETTE.crane);
    h.box(0.05, -0.03, 0.061, 0.04, 0.025, 0.004, 0x3e4a55);
    h.box(0, 0.02, jib / 2, 0.035, 0.035, jib, PALETTE.crane);
    for (let z = 0.06; z < jib; z += 0.06) h.box(0, 0.055, z, 0.035, 0.006, 0.006, PALETTE.crane);
    h.box(0, 0.02, -0.16, 0.035, 0.03, 0.32, PALETTE.crane);
    h.box(0, 0.0, -0.26, 0.07, 0.07, 0.1, PALETTE.concrete[1]);
    h.box(0, 0.02, 0, 0.02, 0.16, 0.02, PALETTE.crane);
    // Тяги от оголовка к стреле и консоли: коробка вдоль +y, повёрнутая к точке (0, 0.04, z)
    const tie = (z: number) => {
      const mt = new THREE.Matrix4().makeTranslation(0, 0.18, 0).multiply(new THREE.Matrix4().makeRotationX(Math.atan2(z, -0.14)));
      h.boxM(mt, 0.004, Math.hypot(z, 0.14), 0.004, STEEL);
    };
    tie(jib * 0.6);
    tie(-0.26);
    const head = new THREE.Mesh(h.build(), this.material);
    head.position.y = top;
    const hook = new THREE.Group();
    const trolley = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.015, 0.04), new THREE.MeshLambertMaterial({ color: STEEL }));
    const cable = new THREE.Mesh(this.cableGeo, new THREE.MeshLambertMaterial({ color: 0x2b2622 }));
    const load = new THREE.Mesh(this.loadGeo, this.material);
    hook.add(trolley, cable, load);
    for (const o of [mast, head, load, trolley]) {
      o.castShadow = true;
      o.receiveShadow = true;
    }
    this.group.add(mast, head, hook);
    // Самосвал с материалами у ворот - у каждой второй стройки, пока идёт каркас
    let truck: THREE.Mesh | null = null;
    if (s.v % 2 === 1) {
      truck = new THREE.Mesh(this.truckGeo, this.material);
      truck.castShadow = true;
      this.group.add(truck);
    }
    const c: Crane = { site: s, head, hook, cable, load, mast, truck, pile: { a: 0, r: 0 }, house: { a: 0, r: 0 }, top, seed: (s.root * 0.618) % 1 * 10 };
    this.place(c);
    return c;
  }

  /** Мачта в дальнем углу площадки; цели стрелы - поддоны и центр дома. */
  private place(c: Crane) {
    const s = c.site, half = s.size * 0.45;
    const mx = s.cx + half * 0.8, mz = s.cz - half * 0.8;
    c.mast.position.set(mx, 0, mz);
    c.head.position.set(mx, c.top, mz);
    const polar = (x: number, z: number) => ({ a: Math.atan2(x - mx, z - mz), r: Math.hypot(x - mx, z - mz) });
    c.pile = polar(s.cx - half * 0.82, s.cz - half * 0.82);
    c.house = polar(s.cx, s.cz);
    if (c.truck) {
      c.truck.visible = s.progress > 0.05 && s.progress < 0.9;
      c.truck.position.set(s.cx + half * 0.35, 0, s.cz + half * 0.55);
      c.truck.rotation.y = -Math.PI / 2;
    }
  }

  private animate(c: Crane) {
    const u = (this.time + c.seed * 3) % CYCLE;
    const ease = (v: number) => v * v * (3 - 2 * v);
    // 0 - над поддонами, 1 - над домом
    const swing = u < 4 ? ease(u / 4) : u < 8 ? 1 : u < 12 ? 1 - ease((u - 8) / 4) : 0;
    const drop = u >= 4 && u < 8 ? Math.sin(((u - 4) / 4) * Math.PI) : u >= 12 ? Math.sin(((u - 12) / 4) * Math.PI) : 0;
    let da = c.house.a - c.pile.a;
    da = Math.atan2(Math.sin(da), Math.cos(da));
    const a = c.pile.a + da * swing;
    const r = c.pile.r + (c.house.r - c.pile.r) * swing;
    c.head.rotation.y = a;
    const [mx, mz] = [c.mast.position.x, c.mast.position.z];
    c.hook.position.set(mx + Math.sin(a) * r, c.top + 0.015, mz + Math.cos(a) * r);
    // Низ: у поддонов - земля, у дома - верх каркаса; груз висит на тросе нужной длины
    const s = c.site;
    const floor = 0.03 + Math.max(1, s.progress * s.floors) * SITE_FLOOR + 0.06;
    const bottom = swing > 0.5 ? floor : 0.12;
    const hang = 0.12 + drop * Math.max(0, c.top - bottom - 0.12);
    c.cable.scale.y = hang;
    c.load.position.y = -hang;
    // Груз лежит у дома и у поддонов попеременно: к дому едет полный, назад - пустой крюк
    c.load.visible = !(swing > 0.5 && u >= 6 && u < 12) && !(swing < 0.5 && u >= 12 && u < 14);
  }

  private drop(c: Crane) {
    c.mast.geometry.dispose();
    c.head.geometry.dispose();
    for (const o of [c.mast, c.head, c.hook, c.truck]) o?.removeFromParent();
  }

  private clear() {
    for (const c of this.cranes) this.drop(c);
    this.cranes = [];
  }
}
