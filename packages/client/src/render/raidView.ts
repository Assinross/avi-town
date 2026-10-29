// Динамический слой налёта: тарелка НЛО, трассеры ПВО и лучи НЛО, взрывы,
// упавшая тарелка с дымом и огнём. Читает w.raid/w.crash и забирает w.fx.

import * as THREE from 'three';
import { BUILDING_BY_ID } from '@avi/data';
import type { Fx, World } from '@avi/sim';

const UFO_SCALE: Record<string, number> = { smallScout: 0.7, scout: 0.95, fighter: 1.05, raider: 1.4, terrorShip: 1.9 };
const ALTITUDE = 2.6;

function makeSaucer(): THREE.Group {
  const g = new THREE.Group();
  const hull = new THREE.MeshLambertMaterial({ color: 0x8d98a6 });
  const dark = new THREE.MeshLambertMaterial({ color: 0x4b5361 });
  const glow = new THREE.MeshBasicMaterial({ color: 0x6ff3ff });
  const top = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.9, 0.18, 20), hull);
  top.position.y = 0.09;
  const bottom = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.5, 0.14, 20), dark);
  bottom.position.y = -0.07;
  const dome = new THREE.Mesh(new THREE.SphereGeometry(0.32, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshLambertMaterial({ color: 0x9fe8ff }));
  dome.position.y = 0.18;
  const core = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.04, 16), glow);
  core.position.y = -0.15;
  g.add(top, bottom, dome, core);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const light = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.05, 0.08), glow);
    light.position.set(Math.cos(a) * 0.82, 0, Math.sin(a) * 0.82);
    g.add(light);
  }
  return g;
}

interface Tracer { line: THREE.Line; life: number; max: number }
interface Boom { mesh: THREE.Mesh; life: number; max: number; size: number }
interface Puff { mesh: THREE.Mesh; life: number; max: number; vx: number; vz: number }

export class RaidView {
  readonly group = new THREE.Group();
  private ufo = makeSaucer();
  private ufoPos = new THREE.Vector3();
  private ufoShown = false;
  private wreck = makeSaucer();
  private fires: THREE.Mesh[] = [];
  private tracers: Tracer[] = [];
  private booms: Boom[] = [];
  private puffs: Puff[] = [];
  private puffGeo = new THREE.IcosahedronGeometry(0.18, 0);
  private boomGeo = new THREE.IcosahedronGeometry(0.5, 1);
  private time = 0;
  private smokeAcc = 0;
  /** 0 - день, 1 - сумерки налёта. */
  mood = 0;

  constructor() {
    this.ufo.visible = false;
    this.wreck.visible = false;
    this.wreck.rotation.set(0.35, 0, 0.2);
    for (let i = 0; i < 3; i++) {
      const f = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.35, 5), new THREE.MeshBasicMaterial({ color: i % 2 ? 0xffb347 : 0xff6a2a }));
      f.visible = false;
      this.fires.push(f);
      this.group.add(f);
    }
    this.group.add(this.ufo, this.wreck);
  }

  private tracer(fx: Extract<Fx, { fromX: number }>, color: number, y0: number, y1: number, life: number) {
    const geo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(fx.fromX / 100, y0, fx.fromY / 100),
      new THREE.Vector3(fx.toX / 100, y1, fx.toY / 100),
    ]);
    const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color, transparent: true }));
    this.group.add(line);
    this.tracers.push({ line, life, max: life });
  }

  private boom(x: number, y: number, z: number, size: number) {
    const mesh = new THREE.Mesh(this.boomGeo, new THREE.MeshBasicMaterial({ color: 0xffa040, transparent: true }));
    mesh.position.set(x, y, z);
    this.group.add(mesh);
    this.booms.push({ mesh, life: 0.5, max: 0.5, size });
  }

  private puff(x: number, y: number, z: number, dark: boolean, size = 1) {
    const mesh = new THREE.Mesh(this.puffGeo, new THREE.MeshLambertMaterial({ color: dark ? 0x4a4542 : 0x8c8580, transparent: true, opacity: 0.8 }));
    mesh.position.set(x + (Math.random() - 0.5) * 0.3, y, z + (Math.random() - 0.5) * 0.3);
    this.group.add(mesh);
    mesh.userData.size = size;
    this.puffs.push({ mesh, life: 2.5, max: 2.5, vx: (Math.random() - 0.5) * 0.1, vz: 0.15 });
  }

  private aaColor(w: World, fx: Extract<Fx, { type: 'aaShot' }>): number {
    const idx = Math.floor(fx.fromY / 100) * w.size + Math.floor(fx.fromX / 100);
    const id = w.tiles[idx]?.def ?? '';
    return { aa_laser: 0x4fd3ff, aa_plasma: 0x7dff6a, aa_fusion: 0xff7af2, aa_phoenix: 0xfff1a0 }[id] ?? (BUILDING_BY_ID[id] ? 0xff8c3a : 0xff8c3a);
  }

  /** Куда наводить прожектор ПВО: текущее положение тарелки. */
  get target(): THREE.Vector3 {
    return this.ufoPos;
  }

  update(w: World, dt: number) {
    this.time += dt;
    // Тарелка: плавно догоняет позицию из симуляции, покачивается и вращается
    if (w.raid) {
      const u = w.raid.ufo;
      const target = new THREE.Vector3(u.x / 100, ALTITUDE + Math.sin(this.time * 2) * 0.1, u.y / 100);
      if (!this.ufoShown) this.ufoPos.copy(target);
      this.ufoPos.lerp(target, Math.min(1, dt * 12));
      this.ufo.position.copy(this.ufoPos);
      this.ufo.scale.setScalar(UFO_SCALE[u.def] ?? 1);
      this.ufo.rotation.y += dt * 1.5;
      this.ufo.visible = true;
      this.ufoShown = true;
    } else {
      this.ufo.visible = false;
      this.ufoShown = false;
    }
    this.mood += ((w.raid ? 1 : 0) - this.mood) * Math.min(1, dt * 1.5);

    // Новые эффекты из симуляции
    for (const fx of w.fx) {
      if (fx.type === 'aaShot') {
        this.tracer(fx, this.aaColor(w, fx), 0.5, ALTITUDE, 0.25);
        if (fx.hit) this.boom(fx.toX / 100, ALTITUDE, fx.toY / 100, 0.6);
      } else if (fx.type === 'ufoShot') {
        this.tracer(fx, 0x9dff4f, ALTITUDE - 0.2, 0.3, 0.35);
      } else if (fx.type === 'fightShot') {
        // Пули и вспышки автобоя рисует BandView
      } else if (fx.type === 'tacShot') {
        // Оружие выше, чем у ПВО: трассер и вспышки идут на высоте ствола
        this.tracer(fx, fx.alien ? 0x7dff6a : 0xffe08a, 0.18, 0.18, 0.3);
        this.boom(fx.fromX / 100, 0.18, fx.fromY / 100, 0.08);
        if (fx.hit) {
          this.boom(fx.toX / 100, 0.18, fx.toY / 100, 0.25);
        } else {
          this.boom(fx.toX / 100, 0.18, fx.toY / 100, 0.1);
          this.puff(fx.toX / 100, 0.2, fx.toY / 100, false, 0.6);
        }
      } else {
        this.boom(fx.x / 100, 0.3, fx.y / 100, fx.big ? 2.2 : 1);
        for (let i = 0; i < (fx.big ? 8 : 3); i++) this.puff(fx.x / 100, 0.4, fx.y / 100, true);
      }
    }
    w.fx.length = 0;

    // Место крушения: тарелка, огонь, дым
    if (w.crash) {
      const cx = w.crash.x + 0.5, cz = w.crash.y + 0.5;
      const landed = !!w.crash.landed;
      this.wreck.visible = true;
      // Десант: тарелка стоит ровно и медленно вращается; сбитая - лежит накренившись
      this.wreck.position.set(cx, landed ? 0.22 : 0.15, cz);
      if (landed) this.wreck.rotation.set(0, this.wreck.rotation.y + dt * 0.6, 0);
      else this.wreck.rotation.set(0.35, 0, 0.2);
      // Обломки умещаются в одну клетку города - на неё в бою приходится "стена" тарелки
      this.wreck.scale.setScalar(Math.min(0.55, (UFO_SCALE[w.crash.ufo] ?? 1) * 0.55));
      this.fires.forEach((f, i) => {
        f.visible = !landed;
        f.position.set(cx + Math.cos(i * 2.1) * 0.45, 0.25 + Math.sin(this.time * 9 + i) * 0.04, cz + Math.sin(i * 2.1) * 0.45);
        f.scale.setScalar(0.8 + Math.sin(this.time * 12 + i * 3) * 0.25);
      });
      this.smokeAcc += dt;
      if (!landed && this.smokeAcc > (w.mission ? 0.6 : 0.25)) {
        this.smokeAcc = 0;
        this.puff(cx, 0.4, cz, false, w.mission ? 0.35 : 1);
      }
    } else {
      this.wreck.visible = false;
      this.fires.forEach((f) => (f.visible = false));
    }

    // Жизнь эффектов
    this.tracers = this.tracers.filter((t) => {
      t.life -= dt;
      (t.line.material as THREE.LineBasicMaterial).opacity = Math.max(0, t.life / t.max);
      if (t.life > 0) return true;
      this.group.remove(t.line);
      t.line.geometry.dispose();
      (t.line.material as THREE.Material).dispose();
      return false;
    });
    this.booms = this.booms.filter((b) => {
      b.life -= dt;
      const k = 1 - b.life / b.max;
      b.mesh.scale.setScalar(0.2 + k * b.size);
      (b.mesh.material as THREE.MeshBasicMaterial).opacity = Math.max(0, 1 - k);
      if (b.life > 0) return true;
      this.group.remove(b.mesh);
      (b.mesh.material as THREE.Material).dispose();
      return false;
    });
    this.puffs = this.puffs.filter((p) => {
      p.life -= dt;
      const k = 1 - p.life / p.max;
      p.mesh.position.x += p.vx * dt;
      p.mesh.position.y += 0.45 * dt;
      p.mesh.position.z += p.vz * dt * 0.3;
      p.mesh.scale.setScalar((0.6 + k * 1.8) * (p.mesh.userData.size ?? 1));
      (p.mesh.material as THREE.MeshLambertMaterial).opacity = Math.max(0, 0.8 * (1 - k));
      if (p.life > 0) return true;
      this.group.remove(p.mesh);
      (p.mesh.material as THREE.Material).dispose();
      return false;
    });
  }
}
