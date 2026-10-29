// Слой рисованных спрайтов (прототип 009, включается адресом ?sprites).
// Земля, дворы и дороги - плоские плитки на земле с мягкими краями; всё, что стоит (бункер, дома,
// здания, деревья, камни, трава, фонари, люди), - "картонки" лицом к камере. У каждого пикселя
// картонки своя глубина из карты глубины рисунка: человек за насыпью бункера прячется, перед
// воротами - виден. Сцена и камера прежние (three.js), меняется только вид.
// Рисунки готовятся по мере надобности: сначала ближние к камере, не дольше PAINT_MS за кадр,
// и складываются на страницы атласа 2048x2048.

import * as THREE from 'three';
import { BUILDING_BY_ID } from '@avi/data';
import { lotCenter, readySoldiers, SPEED_FACTOR, usesLots, ZONE_BUILD_DAYS, type Tile, type World } from '@avi/sim';
import { bunkerFace } from '../cityMesh';
import {
  BUNKER_SANDBAGS, BUNKER_UPS, GROUND_OVER, GROUND_TILE, GROUND_VARIANTS, paintBunker, paintGround, paintPerson, paintRoad, paintRock,
  paintRubble, paintSandbags, paintTree, paintTuft, STRIDE, TERRAIN_ORDER, WALK_FRAMES, type PersonKind, type Terrain,
} from './art';
import { paintBuilding, paintLamp, paintRuin, paintSite, paintStakes, paintVehicle, paintWreck } from './buildings';
import { paintHome, paintShop } from './homes';
import { paintFarm, paintWorks } from './works';
import type { Painted } from './painter';

/** Прототип включается адресом ?sprites. */
export const SPRITES = typeof location !== 'undefined' && new URLSearchParams(location.search).has('sprites');

const PAGE = 2048;
/** Сколько миллисекунд за кадр можно рисовать новые спрайты; при большой очереди (запуск) - дольше. */
const PAINT_MS = 24, PAINT_MS_BUSY = 48;
/** Как часто загружать новые рисунки в видеокарту, пока очередь не пуста, с. */
const FLUSH_S = 0.8;
/** Сколько бойцов из готовых к бою стоят у бункера. */
const GUARDS = 3;
/** Скорость дозорного, клеток в секунду на x1. */
const PATROL_SPEED = 0.14;
/** Обход бункера в его координатах (u вдоль фасада, f к дороге): за насыпью и перед мешками. */
const PATROL: [number, number][] = [[-1.62, -1.5], [1.62, -1.5], [1.62, 1.45], [-1.62, 1.45]];
/** Индекс DIRS участка (+x, -x, +y, -y) -> фасад (0 - к +z, 1 - к +x, 2 - к -z, 3 - к -x), как в cityMesh. */
const FACE_OF_DIR = [1, 3, 0, 2];
const EMPTY_DEPTH = THREE.DataUtils.toHalfFloat(-50);
/** Тёплый свет окон и фонарей ночью: ярче 1, чтобы его подхватило ночное свечение кадра. */
const GLOW = new THREE.Color(2.2, 1.55, 0.8);
/** Пятно света фонаря на земле: радиус в клетках и сила. */
const POOL_R = 0.65, POOL = 0.85;
/** Пятно света фар перед машиной: радиус и вынос вперёд от центра машины, в клетках. */
const BEAM_R = 0.26, BEAM_AHEAD = 0.3;

/** Место рисунка на странице атласа и его рамка в единицах экрана относительно точки привязки. */
interface Entry {
  page: number;
  rect: [number, number, number, number];
  box: [number, number, number, number];
}

const SPRITE_VERT = /* glsl */ `
  attribute vec3 iPos;
  attribute vec4 iRect;
  attribute vec4 iBox;
  attribute float iScale;
  varying vec2 vUv;
  varying vec3 vView;
  varying float vScale;
  void main() {
    vec4 a = viewMatrix * vec4(iPos, 1.0);
    vec2 off = (iBox.xy + position.xy * iBox.zw) * iScale;
    vView = vec3(a.xy + off, a.z);
    vUv = mix(iRect.xy, iRect.zw, position.xy);
    vScale = iScale;
    gl_Position = projectionMatrix * vec4(vView, 1.0);
  }
`;

const SPRITE_FRAG = /* glsl */ `
  uniform mat4 projectionMatrix;
  uniform sampler2D uColor;
  uniform sampler2D uDepth;
  uniform vec3 uTint;
  uniform float uNight;
  uniform vec3 uGlow;
  varying vec2 vUv;
  varying vec3 vView;
  varying float vScale;
  void main() {
    vec4 c = texture2D(uColor, vUv);
    if (c.a < 0.05) discard;
    vec2 dg = texture2D(uDepth, vUv).rg;
    // Глубина пикселя рисунка: настоящая, как у объёмного предмета
    float z = vView.z + dg.r * vScale;
    vec4 clip = projectionMatrix * vec4(vView.xy, z, 1.0);
    gl_FragDepth = clip.z / clip.w * 0.5 + 0.5;
    // Ночью окна загораются по одному: порядок включения из рисунка, лампы - первыми
    float lit = dg.g > 0.0 ? smoothstep(dg.g - 0.04, dg.g, uNight * 0.8) : 0.0;
    gl_FragColor = vec4(mix(c.rgb * uTint, uGlow * (0.75 + 0.25 * c.r), lit), c.a);
    #include <colorspace_fragment>
  }
`;

const GROUND_VERT = /* glsl */ `
  attribute vec2 iCell;
  attribute vec4 iRect;
  attribute float iRot;
  uniform float uView;
  uniform float uOver;
  varying vec2 vUv;
  varying vec2 vWorld;
  void main() {
    vec2 p = position.xz * (1.0 + 2.0 * uOver);
    vec2 w = iCell + 0.5 + p;
    vWorld = w;
    vec2 uv = position.xz + 0.5;
    // Мазки земли повёрнуты к экрану: узор земли поворачивается вместе с камерой; дорога - нет
    float r = iRot < 0.0 ? 0.0 : mod(iRot + uView, 4.0);
    for (int k = 0; k < 3; k++) if (float(k) < r) uv = vec2(uv.y, 1.0 - uv.x);
    vUv = vec2(mix(iRect.x, iRect.z, uv.x), mix(iRect.w, iRect.y, uv.y));
    gl_Position = projectionMatrix * viewMatrix * vec4(w.x, 0.004, w.y, 1.0);
  }
`;

const GROUND_FRAG = /* glsl */ `
  uniform sampler2D uColor;
  uniform vec3 uTint;
  varying vec2 vUv;
  varying vec2 vWorld;
  float h(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float n(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(h(i), h(i + vec2(1, 0)), f.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), f.x), f.y);
  }
  void main() {
    vec4 c = texture2D(uColor, vUv);
    if (c.a < 0.02) discard;
    // Крупные пятна света по всей карте: повтор плиток не бросается в глаза
    float m = n(vWorld * 0.23) * 0.6 + n(vWorld * 0.61) * 0.4;
    vec3 col = c.rgb * (0.93 + m * 0.14) * vec3(1.0 + (m - 0.5) * 0.04, 1.0, 1.0 - (m - 0.5) * 0.05);
    gl_FragColor = vec4(col * uTint, c.a);
    #include <colorspace_fragment>
  }
`;

const POOL_VERT = /* glsl */ `
  attribute vec2 iCell;
  uniform float uR;
  varying vec2 vLocal;
  void main() {
    vLocal = position.xz * 2.0;
    vec2 w = iCell + position.xz * uR * 2.0;
    gl_Position = projectionMatrix * viewMatrix * vec4(w.x, 0.006, w.y, 1.0);
  }
`;

const POOL_FRAG = /* glsl */ `
  uniform float uNight;
  uniform vec3 uGlow;
  varying vec2 vLocal;
  void main() {
    float d = length(vLocal);
    float k = (1.0 - smoothstep(0.0, 1.0, d)) * smoothstep(0.1, 0.6, uNight) * ${POOL.toFixed(2)};
    gl_FragColor = vec4(uGlow * k * 0.35, 1.0);
  }
`;

interface Placed {
  e: Entry;
  x: number;
  y: number;
  z: number;
  scale?: number;
}

/** Набор картонок одной страницы атласа - один вызов отрисовки. */
class SpriteBatch {
  readonly mesh: THREE.Mesh;
  private geo = new THREE.InstancedBufferGeometry();
  private pos!: THREE.InstancedBufferAttribute;
  private rect!: THREE.InstancedBufferAttribute;
  private box!: THREE.InstancedBufferAttribute;
  private scale!: THREE.InstancedBufferAttribute;

  constructor(material: THREE.Material, private capacity: number, order: number) {
    this.geo.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0], 3));
    this.geo.setIndex([0, 1, 2, 0, 2, 3]);
    this.alloc();
    this.geo.instanceCount = 0;
    this.mesh = new THREE.Mesh(this.geo, material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = order;
    this.mesh.userData.noOutline = true;
  }

  private alloc() {
    const attr = (name: string, size: number) => {
      const a = new THREE.InstancedBufferAttribute(new Float32Array(this.capacity * size), size);
      a.setUsage(THREE.DynamicDrawUsage);
      this.geo.setAttribute(name, a);
      return a;
    };
    this.pos = attr('iPos', 3);
    this.rect = attr('iRect', 4);
    this.box = attr('iBox', 4);
    this.scale = attr('iScale', 1);
  }

  /** Картонки дальние сначала: мягкие края ближних ложатся поверх дальних. */
  set(items: Placed[], toward: THREE.Vector3) {
    items.sort((a, b) => (a.x * toward.x + a.y * toward.y + a.z * toward.z) - (b.x * toward.x + b.y * toward.y + b.z * toward.z));
    if (items.length > this.capacity) {
      this.capacity = Math.ceil(items.length * 1.5);
      this.alloc();
    }
    const p = this.pos.array as Float32Array, r = this.rect.array as Float32Array, b = this.box.array as Float32Array, s = this.scale.array as Float32Array;
    items.forEach((it, i) => {
      p[i * 3] = it.x; p[i * 3 + 1] = it.y; p[i * 3 + 2] = it.z;
      r.set(it.e.rect, i * 4);
      b.set(it.e.box, i * 4);
      s[i] = it.scale ?? 1;
    });
    for (const a of [this.pos, this.rect, this.box, this.scale]) {
      a.clearUpdateRanges();
      a.addUpdateRange(0, items.length * a.itemSize);
      a.needsUpdate = true;
    }
    this.geo.instanceCount = items.length;
  }
}

/** Страница атласа: холст рисунков, карта глубины, свой материал и два набора картонок. */
class Page {
  readonly canvas = document.createElement('canvas');
  readonly ctx: CanvasRenderingContext2D;
  /** Глубина и ночной свет пикселей парами (R - глубина, G - порядок включения). */
  readonly half = new Uint16Array(PAGE * PAGE * 2);
  readonly color: THREE.CanvasTexture;
  readonly depth: THREE.DataTexture;
  readonly material: THREE.ShaderMaterial;
  readonly statics: SpriteBatch;
  readonly people: SpriteBatch;
  x = 0;
  y = 0;
  row = 0;
  dirty = false;

  constructor(tint: { value: THREE.Color }, night: { value: number }) {
    for (let i = 0; i < PAGE * PAGE; i++) this.half[i * 2] = EMPTY_DEPTH;
    this.canvas.width = this.canvas.height = PAGE;
    this.ctx = this.canvas.getContext('2d')!;
    this.color = new THREE.CanvasTexture(this.canvas);
    this.color.colorSpace = THREE.SRGBColorSpace;
    this.color.anisotropy = 4;
    this.depth = new THREE.DataTexture(this.half, PAGE, PAGE, THREE.RGFormat, THREE.HalfFloatType);
    this.depth.minFilter = this.depth.magFilter = THREE.NearestFilter;
    this.material = new THREE.ShaderMaterial({
      uniforms: { uColor: { value: this.color }, uDepth: { value: this.depth }, uTint: tint, uNight: night, uGlow: { value: GLOW } },
      vertexShader: SPRITE_VERT,
      fragmentShader: SPRITE_FRAG,
      transparent: true,
      depthWrite: true,
    });
    this.statics = new SpriteBatch(this.material, 4096, 0);
    this.people = new SpriteBatch(this.material, 64, 1);
  }

  /** Положить рисунок на страницу; null - места нет. */
  place(p: Painted, index: number): Entry | null {
    if (this.x + p.w + 2 > PAGE) {
      this.x = 0;
      this.y += this.row + 2;
      this.row = 0;
    }
    if (this.y + p.h + 2 > PAGE) return null;
    const px = this.x, py = this.y;
    this.x += p.w + 2;
    this.row = Math.max(this.row, p.h);
    this.ctx.drawImage(p.canvas, px, py);
    // Глубина в DataTexture снизу вверх, рисунок на холсте - сверху вниз
    for (let j = 0; j < p.h; j++) {
      const dst = (PAGE - 1 - (py + j)) * PAGE + px;
      for (let i = 0; i < p.w; i++) {
        this.half[(dst + i) * 2] = THREE.DataUtils.toHalfFloat(p.depth[j * p.w + i]);
        this.half[(dst + i) * 2 + 1] = THREE.DataUtils.toHalfFloat(p.glow[j * p.w + i]);
      }
    }
    this.dirty = true;
    return {
      page: index,
      rect: [px / PAGE, 1 - (py + p.h) / PAGE, (px + p.w) / PAGE, 1 - py / PAGE],
      box: [-p.ax / p.ppu, -(p.h - p.ay) / p.ppu, p.w / p.ppu, p.h / p.ppu],
    };
  }

  upload() {
    if (!this.dirty) return;
    this.dirty = false;
    this.color.needsUpdate = true;
    this.depth.needsUpdate = true;
  }
}

/** Человек на улице для слоя: где он и куда смотрит. */
export interface Figure {
  id: object;
  x: number;
  z: number;
  yaw: number;
  walking: boolean;
  kind: PersonKind;
  scale: number;
}

type Put = (key: string, paint: () => Painted, x: number, z: number) => void;

/** Машины для слоя: model 0..5 как в traffic.ts; броневик с кадром мигалки 0..2. */
export interface Traffic {
  cars: Iterable<{ x: number; z: number; yaw: number; model: number }>;
  apc: { x: number; z: number; yaw: number; siren: number } | null;
}

const hash = (i: number, s: number) => {
  const v = Math.sin(i * 12.9898 + s * 78.233) * 43758.5453;
  return v - Math.floor(v);
};

export class SpriteLayer {
  readonly group = new THREE.Group();
  private pages: Page[] = [];
  private entries = new Map<string, Entry>();
  /** Ждут рисования: ключ -> художник и удалённость от камеры (ближние рисуются первыми). */
  private queue = new Map<string, { paint: () => Painted; far: number }>();
  private tint = { value: new THREE.Color(1, 1, 1) };
  private night = { value: 0 };
  /** Пятна света фонарей на земле. */
  private pools: THREE.Mesh;
  private poolGeo = new THREE.InstancedBufferGeometry();
  private beamGeo = new THREE.InstancedBufferGeometry();
  private beamPos = new THREE.InstancedBufferAttribute(new Float32Array(512), 2);
  private groundTex: THREE.CanvasTexture;
  private groundRects = new Map<string, [number, number, number, number]>();
  private groundMat: THREE.ShaderMaterial;
  private ground: THREE.Mesh;
  private groundGeo = new THREE.InstancedBufferGeometry();
  private dirty = true;
  private view = -1;
  private toward = new THREE.Vector3();
  private target = new THREE.Vector3();
  private time = 0;
  private patrol = 0;
  /** Метка дозорного для счёта его шагов. */
  private guard = {};
  /** Пройденный путь каждого человека - кадр шага по нему, ноги не скользят. */
  private steps = new WeakMap<object, { x: number; z: number; dist: number }>();
  private crossings: Set<number> = new Set();
  /** Есть нарисованное, но ещё не загруженное в видеокарту; когда загружали в последний раз. */
  private unsent = false;
  private sentAt = 0;
  /** Сколько миллисекунд ушло на рисование: земля при запуске и спрайты по мере надобности. */
  groundMs = 0;
  paintMs = 0;
  painted = 0;

  constructor() {
    const t0 = performance.now();
    this.groundTex = this.paintGroundAtlas();
    this.groundMs = performance.now() - t0;
    this.groundMat = new THREE.ShaderMaterial({
      uniforms: { uColor: { value: this.groundTex }, uTint: this.tint, uView: { value: 0 }, uOver: { value: GROUND_OVER } },
      vertexShader: GROUND_VERT,
      fragmentShader: GROUND_FRAG,
      transparent: true,
      depthWrite: false,
    });
    const quad = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    this.groundGeo.setAttribute('position', quad.getAttribute('position'));
    this.groundGeo.setIndex(quad.getIndex());
    this.ground = new THREE.Mesh(this.groundGeo, this.groundMat);
    this.ground.frustumCulled = false;
    this.ground.renderOrder = -10;
    this.ground.userData.noOutline = true;
    this.group.add(this.ground);
    const poolMat = (r: number) => new THREE.ShaderMaterial({
      uniforms: { uNight: this.night, uGlow: { value: GLOW }, uR: { value: r } },
      vertexShader: POOL_VERT,
      fragmentShader: POOL_FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    for (const g of [this.poolGeo, this.beamGeo]) {
      g.setAttribute('position', quad.getAttribute('position'));
      g.setIndex(quad.getIndex());
      g.instanceCount = 0;
    }
    this.beamPos.setUsage(THREE.DynamicDrawUsage);
    this.beamGeo.setAttribute('iCell', this.beamPos);
    this.pools = new THREE.Mesh(this.poolGeo, poolMat(POOL_R));
    const beams = new THREE.Mesh(this.beamGeo, poolMat(BEAM_R));
    for (const m of [this.pools, beams]) {
      m.frustumCulled = false;
      m.renderOrder = -5;
      m.userData.noOutline = true;
      this.group.add(m);
    }
    console.info(`?sprites: земля и дороги - ${this.groundRects.size} плиток за ${Math.round(this.groundMs)} мс`);
  }

  private paintGroundAtlas(): THREE.CanvasTexture {
    const tiles: [string, HTMLCanvasElement][] = [];
    for (const t of TERRAIN_ORDER) for (let v = 0; v < GROUND_VARIANTS; v++) tiles.push([`${t}${v}`, paintGround(t, v)]);
    for (let m = 0; m < 16; m++) tiles.push([`road${m}`, paintRoad(m)]);
    tiles.push(['road5z', paintRoad(5, true)], ['road10z', paintRoad(10, true)]);
    const cols = 8, rows = Math.ceil(tiles.length / cols), S = GROUND_TILE + 4;
    const canvas = document.createElement('canvas');
    canvas.width = cols * S;
    canvas.height = rows * S;
    const ctx = canvas.getContext('2d')!;
    tiles.forEach(([key, c], i) => {
      const x = (i % cols) * S + 2, y = Math.floor(i / cols) * S + 2;
      ctx.drawImage(c, x, y);
      this.groundRects.set(key, [x / canvas.width, 1 - (y + GROUND_TILE) / canvas.height, (x + GROUND_TILE) / canvas.width, 1 - y / canvas.height]);
    });
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    return tex;
  }

  /** Рисунок по ключу; ещё не нарисован - встаёт в очередь, а пока не показывается. */
  private sprite(key: string, paint: () => Painted, x = this.target.x, z = this.target.z): Entry | null {
    const e = this.entries.get(key);
    if (e) return e;
    const far = Math.hypot(x - this.target.x, z - this.target.z);
    const q = this.queue.get(key);
    if (!q) this.queue.set(key, { paint, far });
    else if (far < q.far) q.far = far;
    return null;
  }

  /** Пока вид после поворота камеры дорисовывается - показать уже готовый вид того же предмета. */
  private otherView(key: string): Entry | null {
    const m = /^(.*:)(\d)$/.exec(key);
    if (!m) return null;
    for (let r = 0; r < 4; r++) {
      const e = this.entries.get(m[1] + r);
      if (e) return e;
    }
    return null;
  }

  /** Дорисовать из очереди ближайшее к камере, пока есть время кадра. */
  private work(): boolean {
    if (!this.queue.size) return false;
    const t0 = performance.now();
    const order = [...this.queue.entries()].sort((a, b) => a[1].far - b[1].far);
    let added = false;
    for (const [key, job] of order) {
      if (performance.now() - t0 > (this.queue.size > 40 ? PAINT_MS_BUSY : PAINT_MS)) break;
      this.queue.delete(key);
      const p = job.paint();
      let page = this.pages[this.pages.length - 1];
      let e = page?.place(p, this.pages.length - 1) ?? null;
      if (!e) {
        page = new Page(this.tint, this.night);
        this.pages.push(page);
        this.group.add(page.statics.mesh, page.people.mesh);
        e = page.place(p, this.pages.length - 1)!;
      }
      this.entries.set(key, e);
      this.painted++;
      added = true;
    }
    this.paintMs += performance.now() - t0;
    return added;
  }

  /** Эти клетки рисует слой: прежние 3D-модели для них не строятся. Тарелка пришельцев остаётся 3D. */
  readonly paints = (t: Tile): boolean => t.object !== 'crash';

  /** Карта изменилась - перестроить землю и неподвижные спрайты. */
  markDirty() {
    this.dirty = true;
  }

  /**
   * Кадр: при смене вида или карты - пересборка неподвижного, люди - каждый кадр.
   * tint - общий свет сцены (день, закат, ночь, налёт); night - темнота 0..1 (огни);
   * crossings - клетки с зеброй; traffic - машины на улицах и броневик отряда.
   */
  update(w: World, camera: THREE.Camera, dt: number, tint: THREE.Color, night: number, figures: Iterable<Figure>, crossings: Set<number>, traffic: Traffic) {
    this.night.value = night;
    this.time += dt;
    camera.getWorldDirection(this.toward).negate();
    // Точка взгляда - на земле под центром экрана
    this.target.copy(camera.position).addScaledVector(this.toward, -camera.position.y / this.toward.y);
    // Вид камеры: 0 - азимут 45 градусов, дальше четверти оборота
    const az = Math.atan2(this.toward.z, this.toward.x);
    const view = (((Math.round((az - Math.PI / 4) / (Math.PI / 2)) % 4) + 4) % 4);
    if (crossings !== this.crossings) {
      this.crossings = crossings;
      this.dirty = true;
    }
    // Новые рисунки уходят в видеокарту пачкой: загрузка страницы атласа дорогая, не на каждый рисунок
    if (this.work()) this.unsent = true;
    if (this.unsent && (!this.queue.size || this.time - this.sentAt > FLUSH_S)) {
      for (const pg of this.pages) pg.upload();
      this.unsent = false;
      this.sentAt = this.time;
      this.dirty = true;
    }
    if (view !== this.view || this.dirty) {
      this.view = view;
      this.dirty = false;
      this.rebuild(w);
    }
    this.tint.value.copy(tint);
    this.groundMat.uniforms.uView.value = view;
    this.updatePeople(w, dt, figures, traffic);
  }

  private groundKey(t: Tile, x: number, y: number): string {
    let px = x, py = y;
    for (let r = 0; r < this.view; r++) [px, py] = [py, -px - 1];
    const q = (px & 1) + (py & 1) * 2;
    let kind: Terrain = t.terrain;
    // Пустой участок торговли - газон с колышками, а не голая площадь; построенный - плитка
    if (t.object === 'zone' && t.zone) kind = (t.zone === 'C' && t.level === 0 && t.build === 0 ? 'yardR' : `yard${t.zone}`) as Terrain;
    else if (t.object === 'building' && t.def !== 'bunker') kind = t.def === 'school' ? 'yardC' : t.def === 'clinic' ? 'yardR' : 'yardI';
    return `${kind}${q}`;
  }

  private rebuild(w: World) {
    const s = w.size;
    const tiles: { order: number; cell: [number, number]; rect: [number, number, number, number]; rot: number }[] = [];
    const items: Placed[] = [];
    const lamps: number[] = [];
    const put: Put = (key, paint, x, z) => {
      const e = this.sprite(key, paint, x, z) ?? this.otherView(key);
      if (e) items.push({ e, x, y: 0, z });
    };
    for (let i = 0; i < w.tiles.length; i++) {
      const t = w.tiles[i];
      if (!w.explored[i] || !this.paints(t)) continue;
      const x = i % s, y = Math.floor(i / s);
      if (t.object === 'road') {
        const mask = roadMask(w, x, y);
        const zebra = (mask === 5 || mask === 10) && this.crossings.has(i);
        tiles.push({ order: TERRAIN_ORDER.length, cell: [x, y], rect: this.groundRects.get(`road${mask}${zebra ? 'z' : ''}`)!, rot: -1 });
        // Фонарь на каждом пятом прямом участке, на тротуаре сбоку - как в cityMesh
        if ((mask === 5 || mask === 10) && !zebra && (x * 7 + y * 13) % 5 === 0) {
          const alongZ = mask === 10;
          const lx = x + 0.5 + (alongZ ? 0.44 : 0), lz = y + 0.5 + (alongZ ? 0 : 0.44);
          // Плечо фонаря - к дороге: у фонаря на +x оно смотрит на -x (четверть 0), на +z - на -z (четверть 3)
          const rel = this.rel(alongZ ? 0 : 3);
          put(`lamp:${rel}`, () => paintLamp(rel), lx, lz);
          // Лампа висит над дорогой - пятно света там, а не у столба
          lamps.push(alongZ ? lx - 0.12 : lx, alongZ ? lz : lz - 0.12);
        }
        continue;
      }
      const key = this.groundKey(t, x, y);
      const kind = key.slice(0, -1) as Terrain;
      tiles.push({ order: TERRAIN_ORDER.indexOf(kind), cell: [x, y], rect: this.groundRects.get(key)!, rot: 0 });
      const cx = x + 0.5, cz = y + 0.5, v = t.variant;
      const jx = (hash(i, 1) - 0.5) * 0.3, jz = (hash(i, 2) - 0.5) * 0.3;
      switch (t.object) {
        case 'tree': {
          const k = t.terrain === 'soil' ? 0 : 1, tv = v % (k ? 4 : 6);
          put(`tree${k}_${tv}`, () => paintTree(k, tv), cx + jx, cz + jz);
          break;
        }
        case 'rubble': {
          if (v % 4 === 3) {
            const rel = this.rel(v >> 2), wv = v % 3;
            put(`wreck${wv}:${rel}`, () => paintWreck(wv, rel), cx, cz);
          } else {
            const rv = v % 4;
            put(`rubble${rv}`, () => paintRubble(rv), cx, cz);
          }
          break;
        }
        case 'ruin': {
          const rel = this.rel(v >> 2), rv = v % 3;
          put(`ruin${rv}:${rel}`, () => paintRuin(rv, rel), cx, cz);
          break;
        }
        case 'zone': this.placeZone(w, t, i, x, y, put); break;
        case 'building': if (t.root === i) this.placeBuilding(w, t, i, items, put); break;
        case 'none': {
          if (t.terrain === 'rock') {
            const rv = v % 4;
            put(`rock${rv}`, () => paintRock(rv), cx + jx, cz + jz);
          }
          if (t.terrain === 'wasteland' || t.terrain === 'soil' || t.terrain === 'contaminated') {
            const dry = t.terrain !== 'soil';
            const n = Math.floor(hash(i, 3) * (dry ? 3 : 4));
            for (let j = 0; j < n; j++) {
              const tv = Math.floor(hash(i, 10 + j) * 6);
              put(`${dry ? 'dry' : 'tuft'}${tv}`, () => paintTuft(tv, dry), x + 0.1 + hash(i, 20 + j) * 0.8, y + 0.1 + hash(i, 30 + j) * 0.8);
            }
          }
        }
      }
    }
    // Земля по порядку наложения: край следующего типа ложится на предыдущий
    tiles.sort((a, b) => a.order - b.order);
    const g = this.groundGeo;
    const cell = new Float32Array(tiles.length * 2), rect = new Float32Array(tiles.length * 4), rot = new Float32Array(tiles.length);
    tiles.forEach((tl, i) => {
      cell.set(tl.cell, i * 2);
      rect.set(tl.rect, i * 4);
      rot[i] = tl.rot;
    });
    g.setAttribute('iCell', new THREE.InstancedBufferAttribute(cell, 2));
    g.setAttribute('iRect', new THREE.InstancedBufferAttribute(rect, 4));
    g.setAttribute('iRot', new THREE.InstancedBufferAttribute(rot, 1));
    g.instanceCount = tiles.length;
    const b = w.bunker;
    if (b) {
      // Рабочий свет у въезда на пандус
      const face = bunkerFace(w, b.root);
      lamps.push(...SpriteLayer.local(face, (b.root % s) + 1.5, Math.floor(b.root / s) + 1.5, 0, 1.2));
    }
    this.poolGeo.setAttribute('iCell', new THREE.InstancedBufferAttribute(new Float32Array(lamps), 2));
    this.poolGeo.instanceCount = lamps.length / 2;
    this.pages.forEach((pg, k) => pg.statics.set(items.filter((it) => it.e.page === k), this.toward));
  }

  /** Жильё и торговля - участком целиком с главной клетки; промзона и ферма - по клетке. */
  private placeZone(w: World, t: Tile, i: number, x: number, y: number, put: Put) {
    if (t.level === 0 && t.build === 0) {
      // Пустой участок: колышки цвета зоны; у жилья и торговли - луг с кустами и редким деревом
      const zk = t.zone ?? 'R';
      put(`stakes${zk}`, () => paintStakes(zk), x + 0.5, y + 0.5);
      if (zk !== 'R' && zk !== 'C') return;
      const n = 1 + Math.floor(hash(i, 5) * 3);
      for (let j = 0; j < n; j++) {
        const tv = Math.floor(hash(i, 40 + j) * 6);
        put(`tuft${tv}`, () => paintTuft(tv, false), x + 0.1 + hash(i, 50 + j) * 0.8, y + 0.1 + hash(i, 60 + j) * 0.8);
      }
      if (hash(i, 7) < 0.3) {
        const tv = Math.floor(hash(i, 8) * 4);
        put(`tree0_${tv}`, () => paintTree(0, tv), x + 0.5, y + 0.5);
      }
      return;
    }
    const v = t.variant;
    if (usesLots(t) && t.root >= 0) {
      if (t.root !== i) return;
      const c = lotCenter(w, i);
      if (!c) return;
      const face = FACE_OF_DIR[c.s.dir], rel = this.rel(face);
      if (t.build > 0) {
        const size = Math.min(c.s.w, c.s.d), prog = stage(1 - t.build / ZONE_BUILD_DAYS[t.level]);
        put(`site${size}:${prog}:${rel}`, () => paintSite(size, prog / 3, rel), c.x, c.y);
        return;
      }
      // Каждый участок со своим вариантом 0..255: соседние дома почти не повторяются
      const lv = t.level, sw = c.s.w, sd = c.s.d;
      const paint = t.zone === 'R' ? () => paintHome(lv, v, sw, sd, rel) : () => paintShop(lv, v, sw, sd, rel);
      put(`lot:${t.zone}${lv}:${v}:${sw}x${sd}:${rel}`, paint, c.x, c.y);
      return;
    }
    const face = facing(w, x, y), rel = this.rel(face);
    if (t.build > 0) {
      const prog = stage(1 - t.build / ZONE_BUILD_DAYS[t.level]);
      put(`site1:${prog}:${rel}`, () => paintSite(1, prog / 3, rel), x + 0.5, y + 0.5);
      return;
    }
    // Как и дома, клетки разные; 40 вариантов хватает, чтобы соседи не повторялись
    const farm = t.zone === 'A', lv = Math.max(1, t.level), vv = v % 40;
    put(`cell:${farm ? 'A' : 'I'}${lv}:${vv}:${rel}`, farm ? () => paintFarm(lv, vv, rel) : () => paintWorks(lv, vv, rel), x + 0.5, y + 0.5);
  }

  private placeBuilding(w: World, t: Tile, root: number, items: Placed[], put: Put) {
    if (t.def === 'bunker') return this.placeBunker(w, root, items);
    const def = BUILDING_BY_ID[t.def!];
    if (!def) return;
    const size = def.size, off = (size - 1) / 2;
    const cx = (root % w.size) + 0.5 + off, cz = Math.floor(root / w.size) + 0.5 + off;
    const face = sideToRoad(w, root, size), rel = this.rel(face);
    if (t.build > 0) {
      const prog = stage(1 - t.build / def.buildDays);
      put(`site${size}:${prog}:${rel}`, () => paintSite(size, prog / 3, rel), cx, cz);
      return;
    }
    const id = def.id;
    put(`bld:${id}:${rel}`, () => paintBuilding(id, size, rel), cx, cz);
  }

  /** Поворот вида: предмет с четвертью q в виде k нарисован как четверть (q + k) в виде 0. */
  private rel(q: number, mod = 4) {
    return (((q + this.view) % mod) + mod) % mod;
  }

  /** Координаты бункера (u вдоль фасада, f к дороге) в мир. */
  private static local(face: number, cx: number, cz: number, u: number, f: number): [number, number] {
    const a = (face * Math.PI) / 2;
    return [cx + u * Math.cos(a) + f * Math.sin(a), cz - u * Math.sin(a) + f * Math.cos(a)];
  }

  private placeBunker(w: World, root: number, items: Placed[]) {
    const face = bunkerFace(w, root);
    const cx = (root % w.size) + 1.5, cz = Math.floor(root / w.size) + 1.5;
    const rel = this.rel(face);
    const ups = w.bunker?.root === root ? w.bunker.upgrades : [];
    const mask = BUNKER_UPS.reduce((m, id, k) => (ups.includes(id) ? m | (1 << k) : m), 0);
    const e = this.sprite(`bunker:${mask}:${rel}`, () => paintBunker(rel, mask), cx, cz) ?? this.otherView(`bunker:${mask}:${rel}`);
    if (e) items.push({ e, x: cx, y: 0, z: cz });
    for (const sb of BUNKER_SANDBAGS) {
      const [x, z] = SpriteLayer.local(face, cx, cz, sb.u, sb.f);
      const r = this.rel(face + sb.quarter, 2);
      const s = this.sprite(`sandbags${r}`, () => paintSandbags(r), x, z);
      if (s) items.push({ e: s, x, y: 0, z });
    }
  }

  /** Восьмая часть оборота относительно вида 0 для направления yaw в мире. */
  private dir8(yaw: number) {
    return (((Math.round(yaw / (Math.PI / 4)) + this.view * 2) % 8) + 8) % 8;
  }

  private person(kind: PersonKind, yaw: number, frame: number, x: number, z: number): Entry | null {
    const dir = this.dir8(yaw);
    return this.sprite(`${kind}_${dir}_${frame}`, () => paintPerson(kind, dir, frame), x, z);
  }

  private frameOf(id: object, x: number, z: number, walking: boolean): number {
    let st = this.steps.get(id);
    if (!st) {
      st = { x, z, dist: 0 };
      this.steps.set(id, st);
    }
    st.dist += Math.hypot(x - st.x, z - st.z);
    st.x = x;
    st.z = z;
    return walking ? 1 + (Math.floor((st.dist / (2 * STRIDE)) * WALK_FRAMES) % WALK_FRAMES) : 0;
  }

  /** Бойцы у бункера (стоят за мешками и обходят бункер), жители и машины на улицах. */
  private updatePeople(w: World, dt: number, figures: Iterable<Figure>, traffic: Traffic) {
    const items: Placed[] = [];
    const add = (e: Entry | null, x: number, z: number, scale = 1) => { if (e) items.push({ e, x, y: 0, z, scale }); };
    const b = w.bunker;
    if (b) {
      const root = b.root, face = bunkerFace(w, root);
      const cx = (root % w.size) + 1.5, cz = Math.floor(root / w.size) + 1.5;
      const n = Math.min(GUARDS, readySoldiers(w).length);
      const yaw = (face * Math.PI) / 2;
      // Часовые за мешками: иногда оглядываются
      for (let g = 0; g < Math.min(2, n); g++) {
        const sb = BUNKER_SANDBAGS[g];
        const [x, z] = SpriteLayer.local(face, cx, cz, sb.u + (g ? -0.05 : 0.05), sb.f - 0.13);
        const look = Math.sin(this.time * 0.4 + g * 2) > 0.7 ? (g ? -1 : 1) * (Math.PI / 4) : 0;
        add(this.person('soldier', yaw + look, 0, x, z), x, z);
      }
      if (n >= 3) {
        // Дозорный: идёт, пока идёт время игры, на паузе стоит
        const moving = SPEED_FACTOR[w.speed] > 0 && !w.mission;
        if (moving) this.patrol += dt * PATROL_SPEED * Math.min(2, SPEED_FACTOR[w.speed]);
        const [x, z, dyaw] = patrolAt(this.patrol);
        const [wx, wz] = SpriteLayer.local(face, cx, cz, x, z);
        add(this.person('soldier', yaw + dyaw, this.frameOf(this.guard, wx, wz, moving), wx, wz), wx, wz);
      }
    }
    for (const f of figures) add(this.person(f.kind, f.yaw, this.frameOf(f.id, f.x, f.z, f.walking), f.x, f.z), f.x, f.z, f.scale);
    // Машины и фары: пятно света на асфальте впереди, только в темноте
    let beams = 0;
    const lit = this.night.value > 0.15;
    const bp = this.beamPos.array as Float32Array;
    for (const c of traffic.cars) {
      const d = this.dir8(c.yaw), m = c.model;
      add(this.sprite(`car${m}_${d}`, () => paintVehicle(m, d), c.x, c.z), c.x, c.z);
      if (lit && beams < bp.length / 2) {
        bp[beams * 2] = c.x + Math.sin(c.yaw) * BEAM_AHEAD;
        bp[beams * 2 + 1] = c.z + Math.cos(c.yaw) * BEAM_AHEAD;
        beams++;
      }
    }
    const apc = traffic.apc;
    if (apc) {
      const d = this.dir8(apc.yaw), sr = apc.siren;
      add(this.sprite(`apc_${d}_${sr}`, () => paintVehicle(6, d, sr), apc.x, apc.z), apc.x, apc.z);
    }
    this.beamPos.needsUpdate = true;
    this.beamGeo.instanceCount = beams;
    this.pages.forEach((pg, k) => pg.people.set(items.filter((it) => it.e.page === k), this.toward));
  }
}

/** Стадия стройки 0..3 - стройка перерисовывается не каждый день, а четырьмя шагами. */
const stage = (p: number) => Math.max(0, Math.min(3, Math.floor(p * 4)));

/** Фасад к ближайшей дороге: 0 - к +z, 1 - к +x, 2 - к -z, 3 - к -x (как facing в cityMesh). */
function facing(w: World, x: number, y: number): number {
  const dirs: [number, number][] = [[0, 1], [1, 0], [0, -1], [-1, 0]];
  for (let i = 0; i < 4; i++) {
    const nx = x + dirs[i][0], ny = y + dirs[i][1];
    if (nx >= 0 && ny >= 0 && nx < w.size && ny < w.size && w.tiles[ny * w.size + nx].object === 'road') return i;
  }
  return 0;
}

/** Сторона здания size x size, к которой подходит больше дорог. */
function sideToRoad(w: World, root: number, size: number): number {
  const x0 = root % w.size, y0 = Math.floor(root / w.size);
  const sides = [0, 0, 0, 0];
  const road = (x: number, y: number) => x >= 0 && y >= 0 && x < w.size && y < w.size && w.tiles[y * w.size + x].object === 'road';
  for (let k = 0; k < size; k++) {
    if (road(x0 + k, y0 + size)) sides[0]++;
    if (road(x0 + size, y0 + k)) sides[1]++;
    if (road(x0 + k, y0 - 1)) sides[2]++;
    if (road(x0 - 1, y0 + k)) sides[3]++;
  }
  return sides.indexOf(Math.max(...sides));
}

/** Точка обхода на пройденном пути s: координаты бункера и поворот лица относительно фасада. */
function patrolAt(s: number): [number, number, number] {
  const lens = PATROL.map((p, i) => Math.hypot(PATROL[(i + 1) % 4][0] - p[0], PATROL[(i + 1) % 4][1] - p[1]));
  let d = s % lens.reduce((a, b) => a + b, 0);
  for (let i = 0; i < 4; i++) {
    if (d <= lens[i]) {
      const [x0, z0] = PATROL[i], [x1, z1] = PATROL[(i + 1) % 4];
      const t = d / lens[i];
      return [x0 + (x1 - x0) * t, z0 + (z1 - z0) * t, Math.atan2(x1 - x0, z1 - z0)];
    }
    d -= lens[i];
  }
  return [PATROL[0][0], PATROL[0][1], 0];
}

/** Маска связей дороги как в cityMesh: тупик и одиночка - прямой участок. */
function roadMask(w: World, x: number, y: number): number {
  let mask = 0;
  const dirs: [number, number][] = [[1, 0], [0, 1], [-1, 0], [0, -1]];
  dirs.forEach(([dx, dy], i) => {
    const nx = x + dx, ny = y + dy;
    if (nx >= 0 && ny >= 0 && nx < w.size && ny < w.size && w.tiles[ny * w.size + nx].object === 'road') mask |= 1 << i;
  });
  if (mask === 0) mask = 10;
  else if ((mask & (mask - 1)) === 0) mask = mask & 5 ? 5 : 10;
  return mask;
}
