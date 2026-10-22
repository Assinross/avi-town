// Ночные огни города: окна, витрины, вывески, гирлянды, фонари, промзона и XCOM.
// Четыре инстансных слоя (ядра огней, ореолы, пятна на земле, конусы фонарей) и небольшой
// пул настоящих точечных источников, который едет за камерой. Свет ровный: мерцания нет,
// только спокойное дыхание огня в бочках. Расписание - в nightPlan.ts.

import * as THREE from 'three';
import type { QualityProfile } from '../platform/device';
import { lightLevel, type LightAnchor, type LightKind } from './nightPlan';
import { beaconLevel } from './searchlight';

const Y_AXIS = new THREE.Vector3(0, 1, 0);

/** Роли огней: сила для настоящих источников и размер пятна на земле (0 - пятна нет). */
const REAL: Record<LightKind, { power: number; reach: number; pool: number }> = {
  window: { power: 0, reach: 0, pool: 0 },
  tv: { power: 0, reach: 0, pool: 0 },
  shopwindow: { power: 1.3, reach: 0.85, pool: 0.7 },
  sign: { power: 1.6, reach: 0, pool: 0 },
  garland: { power: 1.1, reach: 0, pool: 0 },
  lamp: { power: 2.4, reach: 1, pool: 0.55 },
  worklight: { power: 1.4, reach: 0.8, pool: 0.75 },
  fire: { power: 1.6, reach: 0.6, pool: 0.6 },
  beacon: { power: 0.6, reach: 0, pool: 0 },
  lab: { power: 1.4, reach: 0, pool: 0 },
  workshop: { power: 1.3, reach: 0.7, pool: 0.7 },
};

/** Во сколько раз ядро ярче базового цвета: фонари и витрины светят сильнее окон. */
const GAIN: Record<LightKind, number> = {
  window: 1.8,
  tv: 1.4,
  shopwindow: 1.5,
  sign: 2,
  garland: 1.4,
  lamp: 1.9,
  worklight: 1.3,
  fire: 1.6,
  beacon: 1.3,
  lab: 1.2,
  workshop: 1.3,
};

/** Яркость ореола относительно ядра: окна жилья и витрины видны издалека. */
const HALO: Partial<Record<LightKind, number>> = { window: 0.75, tv: 0.7, shopwindow: 0.7, sign: 0.75 };

/** Подсветка фасада магазина: ореол во всю витрину и вверх по стене. */
const FACADE_H = 0.62;

/** Огни, которые стоят низко и правда светят на землю и стены. */
const REAL_LIGHT = new Set<LightKind>(['lamp', 'shopwindow', 'fire', 'worklight', 'workshop']);

/** Плавное переключение: за сколько секунд окно разгорается и гаснет. */
const FADE = 0.22;

interface Entry {
  a: LightAnchor;
  core: THREE.Color;
  halo: THREE.Color;
  pool: THREE.Color;
  /** Индекс в слоях ядер и ореолов. */
  i: number;
  /** Индекс в слое пятен на земле, -1 если пятна нет. */
  p: number;
  /** Индекс в слое конусов фонарей, -1 если конуса нет. */
  beam: number;
  /** Текущая яркость и цель: между ними идёт плавный переход. */
  b: number;
  target: number;
}

/** Мягкий прямоугольник: ровная середина и растворённые края - форма самих огней. */
function softRectTexture(): THREE.Texture {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#ffffff';
  ctx.filter = 'blur(7px)';
  ctx.fillRect(15, 13, 34, 38);
  ctx.filter = 'none';
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.fillRect(22, 20, 20, 24);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Мягкое пятно: белый центр, прозрачный край - общая текстура ореолов и пятен. */
function glowTexture(): THREE.Texture {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.25, 'rgba(255,255,255,0.45)');
  g.addColorStop(0.6, 'rgba(255,255,255,0.12)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export class NightLights {
  private coreMesh: THREE.InstancedMesh;
  private haloMesh: THREE.InstancedMesh;
  private poolMesh: THREE.InstancedMesh;
  private beamMesh: THREE.InstancedMesh;
  private coreMat: THREE.MeshBasicMaterial;
  private haloMat: THREE.MeshBasicMaterial;
  private poolMat: THREE.MeshBasicMaterial;
  private beamMat: THREE.MeshBasicMaterial;
  private capacity = 0;
  private all: Entry[] = [];
  private fires: Entry[] = [];
  private beacons: Entry[] = [];
  /** Огни, которые прямо сейчас плавно меняют яркость. */
  private moving = new Set<Entry>();
  /** Центр боя: огни вокруг него светят чуть сильнее, а настоящие источники набираются рядом. */
  private focus: { x: number; z: number } | null = null;
  private lights: THREE.PointLight[] = [];
  private time = 0;
  private acc = 1;
  private lightAcc = 1;
  private scratch = new THREE.Color();
  private m = new THREE.Matrix4();
  private pos = new THREE.Vector3();
  private scl = new THREE.Vector3();
  private q = new THREE.Quaternion();

  constructor(private scene: THREE.Scene, private quality: QualityProfile) {
    const glow = glowTexture();
    this.coreMat = new THREE.MeshBasicMaterial({ map: softRectTexture(), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    this.haloMat = new THREE.MeshBasicMaterial({ map: glow, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    this.poolMat = new THREE.MeshBasicMaterial({ map: glow, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: true });
    this.beamMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    this.coreMesh = this.makeMesh('core');
    this.haloMesh = this.makeMesh('halo');
    this.poolMesh = this.makeMesh('pool');
    this.beamMesh = this.makeMesh('beam');
    // Настоящие источники: столько, сколько разрешил профиль качества
    for (let i = 0; i < quality.nightLights; i++) {
      const light = new THREE.PointLight(0xffcf8f, 0, 9, 2);
      light.intensity = 0;
      this.scene.add(light);
      this.lights.push(light);
    }
  }

  /** Инстансный слой огней нужной формы: плоскость фасада, пятно на земле или конус фонаря. */
  private makeMesh(layer: 'core' | 'halo' | 'pool' | 'beam'): THREE.InstancedMesh {
    let geo: THREE.PlaneGeometry | THREE.ConeGeometry;
    let mat: THREE.MeshBasicMaterial;
    if (layer === 'pool') geo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    else if (layer === 'beam') {
      // Вершина конуса у лампы, основание - пятно на земле
      geo = new THREE.ConeGeometry(0.5, 0.52, 10, 1, true);
      geo.translate(0, -0.26, 0);
    } else geo = new THREE.PlaneGeometry(1, 1);
    mat = layer === 'core' ? this.coreMat : layer === 'halo' ? this.haloMat : layer === 'pool' ? this.poolMat : this.beamMat;
    const mesh = new THREE.InstancedMesh(geo, mat, 1);
    mesh.count = 0;
    mesh.frustumCulled = false;
    mesh.renderOrder = layer === 'beam' ? 2 : 3;
    mesh.userData.noOutline = true;
    this.scene.add(mesh);
    return mesh;
  }

  /** Полная пересборка списка огней: вызывается после перестройки участков карты. */
  setAnchors(chunks: LightAnchor[][]) {
    const all: LightAnchor[] = [];
    for (const list of chunks) if (list) for (const a of list) all.push(a);
    if (all.length > this.capacity) this.grow(Math.max(256, Math.ceil(all.length * 1.2)));
    this.coreMesh.count = Math.min(all.length, this.capacity);
    this.haloMesh.count = this.coreMesh.count;
    this.all = [];
    this.fires = [];
    this.beacons = [];
    this.moving.clear();
    const c = new THREE.Color();
    let p = 0, beam = 0;
    for (const a of all) {
      const i = this.all.length;
      const entry: Entry = {
        a, core: new THREE.Color(a.color), halo: new THREE.Color(a.color), pool: new THREE.Color(a.color),
        i, p: -1, beam: -1, b: 0, target: 0,
      };
      entry.halo.multiplyScalar(HALO[a.kind] ?? 0.45);
      entry.pool.multiplyScalar(0.3);
      this.all.push(entry);
      if (a.kind === 'fire') this.fires.push(entry);
      if (a.kind === 'beacon') this.beacons.push(entry);
      const nx = Math.sin(a.rot), nz = Math.cos(a.rot);
      // Ядро - прямоугольник в плоскости фасада, чуть отодвинут от стены
      this.q.setFromAxisAngle(Y_AXIS, a.rot);
      this.pos.set(a.x + nx * 0.012, a.y, a.z + nz * 0.012);
      // Окна жилья чуть крупнее рамы: мягкий край текстуры съедает треть
      const grow = a.kind === 'window' || a.kind === 'tv' ? 1.35 : 1;
      this.scl.set(Math.max(0.02, a.w * grow), Math.max(0.02, a.h * grow), 1);
      this.m.compose(this.pos, this.q, this.scl);
      this.coreMesh.setMatrixAt(i, this.m);
      // Ореол - мягкое пятно того же направления: высокое окно светит выше, витрина - шире.
      // Витрина магазина подсвечивает весь фасад: широкое пятно от земли вверх по стене
      this.pos.set(a.x + nx * 0.024, a.y, a.z + nz * 0.024);
      if (a.kind === 'shopwindow') {
        this.pos.y = FACADE_H / 2;
        this.scl.set(Math.max(0.3, a.w * 2.2), FACADE_H, 1);
      } else {
        const big = Math.max(0.1, Math.max(a.h * (a.kind === 'window' ? 4.2 : 3.2), a.w * 1.3));
        this.scl.set(big, big, 1);
      }
      this.m.compose(this.pos, this.q, this.scl);
      this.haloMesh.setMatrixAt(i, this.m);
      c.set(0x000000);
      this.coreMesh.setColorAt(i, c);
      this.haloMesh.setColorAt(i, c);
      // Пятно на земле под источником, сдвинуто от стены наружу
      const size = REAL[a.kind].pool;
      if (size > 0 && p < this.coreMesh.count) {
        entry.p = p++;
        this.pos.set(a.x + nx * 0.24, 0.02, a.z + nz * 0.24);
        this.scl.set(size * 1.6, size * 1.6, 1);
        this.m.compose(this.pos, this.q.identity(), this.scl);
        this.poolMesh.setMatrixAt(entry.p, this.m);
        this.poolMesh.setColorAt(entry.p, c);
      }
      // Конус света у дорожных фонарей: столб от плафона до пятна на асфальте
      if (a.kind === 'lamp' && beam < this.capacity) {
        entry.beam = beam++;
        this.q.setFromAxisAngle(Y_AXIS, a.rot);
        this.pos.set(a.x, a.y + 0.02, a.z);
        this.scl.set(1, 1, 1);
        this.m.compose(this.pos, this.q, this.scl);
        this.beamMesh.setMatrixAt(entry.beam, this.m);
        this.beamMesh.setColorAt(entry.beam, c);
      }
    }
    this.coreMesh.count = this.all.length;
    this.haloMesh.count = this.all.length;
    this.poolMesh.count = p;
    this.beamMesh.count = beam;
    for (const mesh of [this.coreMesh, this.haloMesh, this.poolMesh, this.beamMesh]) {
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
    this.acc = 1;
    this.lightAcc = 1;
  }

  /** Буферы под новое число огней: растём заранее, чтобы не пересоздавать каждый кадр. */
  private grow(capacity: number) {
    this.capacity = capacity;
    for (const old of [this.coreMesh, this.haloMesh, this.poolMesh, this.beamMesh]) {
      this.scene.remove(old);
      old.geometry.dispose();
      old.dispose();
    }
    this.coreMesh = this.makeMesh('core');
    this.haloMesh = this.makeMesh('halo');
    this.poolMesh = this.makeMesh('pool');
    this.beamMesh = this.makeMesh('beam');
    // makeMesh создаёт счётчик 1 - растим буферы до нужного числа
    for (const mesh of [this.coreMesh, this.haloMesh, this.poolMesh, this.beamMesh]) {
      mesh.count = 0;
      mesh.instanceMatrix = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 16), 16);
      mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    }
  }

  /**
   * Кадр ночи: час суток, общая темнота 0..1 и камера.
   * Яркость пересчитывается не каждый кадр, а переходы идут плавно.
   */
  update(hour: number, dark: number, camera: THREE.Camera, dt: number, focus?: { x: number; z: number }) {
    const gate = Math.min(1, Math.max(0, (dark - 0.12) / 0.45));
    this.time += dt;
    // Смена места боя перекрашивает огни: ближние к бою светят ярче
    if ((focus?.x ?? 0) !== (this.focus?.x ?? 0) || (focus?.z ?? 0) !== (this.focus?.z ?? 0)) {
      this.focus = focus ?? null;
      this.acc = 1;
    }
    this.acc += dt;
    if (this.acc >= 0.09) {
      this.acc = 0;
      this.refresh(hour, gate);
    }
    this.fade(dt);
    this.breathe(gate);
    this.lightAcc += dt;
    if (this.lightAcc >= 0.12) {
      this.lightAcc = 0;
      this.aim(camera, gate);
    }
  }

  /** Цель свечения каждого огня по расписанию; переход к ней делает fade. */
  private refresh(hour: number, gate: number) {
    for (const e of this.all) {
      // Огонь и маячки живут своим ритмом - их ведёт breathe
      if (e.a.kind === 'fire' || e.a.kind === 'beacon') continue;
      const b = e.a.kind === 'lamp' ? gate : gate * lightLevel(e.a.kind, e.a.seed, hour, e.a.level);
      if (Math.abs(b - e.target) < 0.004) continue;
      e.target = b;
      this.moving.add(e);
    }
  }

  /** Плавный переход окон и витрин: 0.2-0.5 секунды, без резких вспышек. */
  private fade(dt: number) {
    if (!this.moving.size) return;
    const k = Math.min(1, Math.max(0.12, dt / FADE));
    for (const e of this.moving) {
      const b = e.b + (e.target - e.b) * k;
      if (Math.abs(e.target - b) < 0.04) {
        this.paint(e, e.target);
        this.moving.delete(e);
      } else this.paint(e, b);
    }
    this.flush();
  }

  /** Спокойное дыхание огня и ровная пульсация маячков - единственное, что меняется само по себе. */
  private breathe(gate: number) {
    if (this.fires.length) {
      const k = 0.9 + 0.1 * Math.sin(this.time * 2.3) * Math.sin(this.time * 1.7);
      for (const e of this.fires) {
        const b = gate * Math.round(k * 8) / 8;
        if (Math.abs(b - e.b) >= 0.06) this.paint(e, b);
      }
    }
    if (this.beacons.length) {
      const b = gate * Math.round(beaconLevel(this.time) * 8) / 8;
      for (const e of this.beacons) if (Math.abs(b - e.b) >= 0.06) this.paint(e, b);
    }
    this.flush();
  }

  private paint(e: Entry, b: number) {
    // Шаг 1/32: переход остаётся плавным, а буфер цвета не трогаем зря
    const q = Math.round(b * 32) / 32;
    if (Math.abs(q - e.b) < 0.02) return;
    e.b = q;
    b = q * this.quality.nightGlow;
    // Улица рядом с боем светит чуть сильнее: юниты видны на фоне домов
    if (this.focus) {
      const dx = e.a.x - this.focus.x, dz = e.a.z - this.focus.z;
      if (dx * dx + dz * dz < 100) b *= 1.15;
    }
    this.scratch.copy(e.core).multiplyScalar(b * GAIN[e.a.kind]);
    this.coreMesh.setColorAt(e.i, this.scratch);
    this.scratch.copy(e.halo).multiplyScalar(b);
    this.haloMesh.setColorAt(e.i, this.scratch);
    if (e.p >= 0) {
      this.scratch.copy(e.pool).multiplyScalar(b);
      this.poolMesh.setColorAt(e.p, this.scratch);
    }
    if (e.beam >= 0) {
      // Конус света - лёгкая дымка: сверху он не должен читаться сплошным абажуром
      this.scratch.copy(e.core).multiplyScalar(b * 0.12);
      this.beamMesh.setColorAt(e.beam, this.scratch);
    }
    this.dirtyCore = true;
  }

  private dirtyCore = false;

  private flush() {
    if (!this.dirtyCore) return;
    this.dirtyCore = false;
    if (this.coreMesh.instanceColor) this.coreMesh.instanceColor.needsUpdate = true;
    if (this.haloMesh.instanceColor) this.haloMesh.instanceColor.needsUpdate = true;
    if (this.poolMesh.instanceColor) this.poolMesh.instanceColor.needsUpdate = true;
    if (this.beamMesh.instanceColor) this.beamMesh.instanceColor.needsUpdate = true;
  }

  /** Ближние к камере источники становятся настоящими точечными огнями: пятна света на стенах. */
  private aim(camera: THREE.Camera, gate: number) {
    if (!this.lights.length) return;
    // В бою источники набираются вокруг места боя, а не камеры
    const cx = this.focus ? this.focus.x : camera.position.x;
    const cz = this.focus ? this.focus.z : camera.position.z;
    const range = this.focus ? 90 : 240;
    const best: { e: Entry; d: number }[] = [];
    for (const e of this.all) {
      if (e.b < 0.05 || !REAL_LIGHT.has(e.a.kind)) continue;
      const dx = e.a.x - cx, dz = e.a.z - cz;
      const d = dx * dx + dz * dz;
      if (d > range) continue;
      if (best.length < this.lights.length) {
        best.push({ e, d });
        best.sort((a, b) => a.d - b.d);
      } else if (d < best[best.length - 1].d) {
        best[best.length - 1] = { e, d };
        best.sort((a, b) => a.d - b.d);
      }
    }
    for (let i = 0; i < this.lights.length; i++) {
      const light = this.lights[i];
      const hit = best[i];
      if (!hit) {
        light.intensity = 0;
        continue;
      }
      const a = hit.e.a;
      const nx = Math.sin(a.rot), nz = Math.cos(a.rot);
      const role = REAL[a.kind];
      light.position.set(a.x + nx * 0.22, Math.max(0.62, a.y + 0.32), a.z + nz * 0.22);
      light.color.copy(hit.e.core);
      light.distance = 5 + role.reach * 5;
      light.intensity = role.power * hit.e.b * gate;
    }
  }
}
